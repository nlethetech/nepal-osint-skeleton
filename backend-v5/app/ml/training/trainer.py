"""Training orchestrator for RL models."""
import logging
import random
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from uuid import uuid4

import numpy as np
from sqlalchemy import select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.ml.config import get_ml_config, MLConfig
from app.ml.evaluation import compute_classification_metrics
from app.ml.models.embedding_linear_classifier import EmbeddingLinearClassifier
from app.ml.models.story_classifier import StoryClassifier
from app.ml.models.priority_bandit import PriorityBandit
from app.ml.models.source_confidence import SourceConfidenceModel
from app.ml.models.anomaly_vae import AnomalyVAE
from app.ml.models.temporal_embedder import TemporalEmbedder
from app.ml.experience_buffer.repository import ExperienceRepository
from app.models.experience_record import ExperienceType
from app.models.rl_model_version import RLModelVersion, ModelType
from app.models.story import Story

logger = logging.getLogger(__name__)

PRIORITIES = ["low", "medium", "high", "critical"]


def _parse_pgvector(vector_text: str) -> np.ndarray:
    """
    Parse pgvector text like: '[-0.1,0.2,...]' into float32 numpy array.
    """
    if not vector_text:
        return np.zeros((0,), dtype=np.float32)

    s = vector_text.strip()
    if s.startswith("[") and s.endswith("]"):
        s = s[1:-1]
    if not s:
        return np.zeros((0,), dtype=np.float32)

    return np.fromstring(s, sep=",", dtype=np.float32)


def _train_eval_split(n: int, eval_frac: float = 0.2, seed: int = 42) -> tuple[list[int], list[int]]:
    idx = list(range(n))
    rnd = random.Random(seed)
    rnd.shuffle(idx)

    eval_n = int(max(1, round(n * eval_frac)))
    eval_idx = idx[:eval_n]
    train_idx = idx[eval_n:]
    return train_idx, eval_idx


def _stratified_train_eval_split(
    y: list[str],
    eval_frac: float = 0.2,
    seed: int = 42,
) -> tuple[list[int], list[int]]:
    """
    Stratified train/eval split by label.

    Helps stabilize metrics on small, imbalanced datasets (common early on).
    """
    if not y:
        return [], []

    by_label: dict[str, list[int]] = {}
    for i, lab in enumerate(y):
        by_label.setdefault(lab, []).append(i)

    rnd = random.Random(seed)
    train_idx: list[int] = []
    eval_idx: list[int] = []

    for idxs in by_label.values():
        rnd.shuffle(idxs)
        if len(idxs) <= 1:
            train_idx.extend(idxs)
            continue

        eval_n = int(max(1, round(len(idxs) * eval_frac)))
        if eval_n >= len(idxs):
            eval_n = len(idxs) - 1

        eval_idx.extend(idxs[:eval_n])
        train_idx.extend(idxs[eval_n:])

    rnd.shuffle(train_idx)
    rnd.shuffle(eval_idx)
    return train_idx, eval_idx


@dataclass
class TrainingResult:
    """Result of training a model."""
    model_type: str
    success: bool
    samples_used: int
    new_accuracy: Optional[float] = None
    previous_accuracy: Optional[float] = None
    new_metrics: Optional[dict] = None
    previous_metrics: Optional[dict] = None
    promoted: bool = False
    error: Optional[str] = None


@dataclass
class TrainingBatchResult:
    """Result of training all models."""
    timestamp: datetime
    results: Dict[str, TrainingResult]
    total_samples: int
    models_promoted: int


class TrainingOrchestrator:
    """
    Orchestrates training of all RL models.

    Training pipeline:
    1. Source Confidence (instant Bayesian update)
    2. Story Classifier (BiLSTM, ~5 min)
    3. Priority Bandit (~2 min)
    4. Anomaly VAE (~3 min)
    5. Temporal Embedder (~5 min)

    Only promotes models if accuracy improves by >= 1%.
    """

    def __init__(
        self,
        db: AsyncSession,
        config: Optional[MLConfig] = None,
    ):
        """
        Initialize the training orchestrator.

        Args:
            db: Database session
            config: ML configuration
        """
        self.db = db
        self.config = config or get_ml_config()
        self.experience_repo = ExperienceRepository(db)

    async def train_all(self) -> TrainingBatchResult:
        """
        Train all models with available experience data.

        Returns:
            TrainingBatchResult with all training results
        """
        logger.info("Starting training orchestration")
        start_time = datetime.now(timezone.utc)

        results: Dict[str, TrainingResult] = {}
        total_samples = 0
        models_promoted = 0

        # 1. Train source confidence (instant)
        source_result = await self._train_source_confidence()
        results["source_confidence"] = source_result
        total_samples += source_result.samples_used
        if source_result.promoted:
            models_promoted += 1

        # 2. Train story classifier
        classifier_result = await self._train_story_classifier()
        results["story_classifier"] = classifier_result
        total_samples += classifier_result.samples_used
        if classifier_result.promoted:
            models_promoted += 1

        # 3. Train priority bandit
        bandit_result = await self._train_priority_bandit()
        results["priority_bandit"] = bandit_result
        total_samples += bandit_result.samples_used
        if bandit_result.promoted:
            models_promoted += 1

        # 4. Train anomaly VAE
        vae_result = await self._train_anomaly_vae()
        results["anomaly_vae"] = vae_result
        total_samples += vae_result.samples_used
        if vae_result.promoted:
            models_promoted += 1

        # 5. Train temporal embedder
        temporal_result = await self._train_temporal_embedder()
        results["temporal_embedder"] = temporal_result
        total_samples += temporal_result.samples_used
        if temporal_result.promoted:
            models_promoted += 1

        logger.info(
            f"Training complete: {total_samples} samples, "
            f"{models_promoted} models promoted"
        )

        return TrainingBatchResult(
            timestamp=start_time,
            results=results,
            total_samples=total_samples,
            models_promoted=models_promoted,
        )

    async def _train_source_confidence(self) -> TrainingResult:
        """Train source confidence model."""
        model_type = "source_confidence"

        try:
            # Get source feedback records
            records = await self.experience_repo.get_unused_for_training(
                ExperienceType.SOURCE,
                limit=1000,
            )

            if not records:
                return TrainingResult(
                    model_type=model_type,
                    success=True,
                    samples_used=0,
                    promoted=False,
                )

            # Initialize model
            model = SourceConfidenceModel(
                prior_alpha=self.config.source_prior_alpha,
                prior_beta=self.config.source_prior_beta,
            )

            # Load existing state
            model_path = self.config.models_dir / "source_confidence" / "latest.json"
            if model_path.exists():
                model.load(model_path)

            # Apply updates (instant for Bayesian model)
            for record in records:
                if record.source_id:
                    is_reliable = record.human_action == "reliable"
                    model.update_from_feedback(record.source_id, is_reliable)

            # Save updated model
            model_path.parent.mkdir(parents=True, exist_ok=True)
            model.save(model_path)

            # Mark records as used
            record_ids = [r.id for r in records]
            await self.experience_repo.mark_as_used(record_ids)

            # Record version
            await self._record_model_version(
                model_type=ModelType.SOURCE_CONFIDENCE,
                accuracy=None,  # Bayesian model doesn't have accuracy
                training_samples=len(records),
                model_path=model_path,
                promoted=True,
            )

            return TrainingResult(
                model_type=model_type,
                success=True,
                samples_used=len(records),
                promoted=True,  # Bayesian updates are always "promoted"
            )

        except Exception as e:
            logger.exception(f"Failed to train {model_type}: {e}")
            return TrainingResult(
                model_type=model_type,
                success=False,
                samples_used=0,
                error=str(e),
            )

    async def _train_story_classifier(self) -> TrainingResult:
        """Train the category classifier from human feedback."""
        model_type = "story_classifier"
        min_samples = self.config.story_classifier.min_samples_to_train

        try:
            # Get classification feedback
            records = await self.experience_repo.get_unused_for_training(
                ExperienceType.CLASSIFICATION,
                limit=1000,
            )

            if len(records) < min_samples:
                logger.info(f"Insufficient samples for {model_type}: {len(records)} < {min_samples}")
                return TrainingResult(
                    model_type=model_type,
                    success=True,
                    samples_used=0,
                    promoted=False,
                )

            # Build dataset from stored story embeddings (fast, language-agnostic)
            story_ids = [r.story_id for r in records if r.story_id and r.human_action]
            if not story_ids:
                return TrainingResult(
                    model_type=model_type,
                    success=True,
                    samples_used=0,
                    promoted=False,
                )

            # Fetch embeddings for story_ids
            rows = (
                await self.db.execute(
                    text(
                        """
                        SELECT story_id, embedding_vector
                        FROM story_embeddings
                        WHERE story_id = ANY(:ids)
                          AND embedding_vector IS NOT NULL
                        """
                    ),
                    {"ids": story_ids},
                )
            ).all()
            emb_by_story: dict = {row[0]: _parse_pgvector(row[1]) for row in rows}

            label_to_idx = {c: i for i, c in enumerate(self.config.categories)}

            X: list[np.ndarray] = []
            y: list[int] = []
            used_record_ids: list = []
            used_story_ids: list = []

            for r in records:
                if not r.story_id or not r.human_action:
                    continue
                lab = r.human_action.lower()
                if lab not in label_to_idx:
                    continue
                emb = emb_by_story.get(r.story_id)
                if emb is None or emb.shape != (self.config.embedding_dim,):
                    continue

                X.append(emb)
                y.append(label_to_idx[lab])
                used_record_ids.append(r.id)
                used_story_ids.append(r.story_id)

            if len(X) < min_samples:
                logger.info(
                    f"Insufficient usable samples for {model_type}: "
                    f"{len(X)} with embeddings < {min_samples}"
                )
                return TrainingResult(
                    model_type=model_type,
                    success=True,
                    samples_used=0,
                    promoted=False,
                )

            X_arr = np.stack(X, axis=0)
            y_arr = np.asarray(y, dtype=np.int64)

            train_idx, eval_idx = _train_eval_split(len(X_arr), eval_frac=0.2)

            X_train = X_arr[train_idx]
            y_train = y_arr[train_idx]
            X_eval = X_arr[eval_idx]
            y_eval_idx = y_arr[eval_idx]
            y_eval = [self.config.categories[i] for i in y_eval_idx.tolist()]

            # Baseline: existing trained embedding model if present; otherwise rule-based keywords.
            models_dir = self.config.models_dir / "story_classifier"
            baseline_path = models_dir / "embedding_latest.pt"
            baseline_loaded = False

            baseline_model = EmbeddingLinearClassifier(self.config.categories, embedding_dim=self.config.embedding_dim)
            if baseline_path.exists():
                baseline_loaded = baseline_model.load(baseline_path)

            if baseline_loaded:
                baseline_preds = [baseline_model.predict(v.tolist()).label for v in X_eval]
            else:
                # Fetch story text for rule-based baseline
                story_map = {
                    s.id: s
                    for s in (
                        await self.db.execute(select(Story).where(Story.id.in_(used_story_ids)))
                    ).scalars().all()
                }
                rule_baseline = StoryClassifier(
                    embedding_dim=self.config.embedding_dim,
                    hidden_dim=self.config.story_classifier.hidden_dim,
                    dropout=self.config.story_classifier.dropout,
                )
                rule_baseline.initialize()
                baseline_preds = []
                for i in eval_idx:
                    sid = used_story_ids[i]
                    st = story_map.get(sid)
                    title = st.title if st else ""
                    summary = st.summary if st else None
                    baseline_preds.append(rule_baseline.classify(title, summary).category)

            baseline_metrics = compute_classification_metrics(
                y_eval,
                [p.lower() for p in baseline_preds],
                labels=self.config.categories,
            )

            # Candidate: train/update embedding classifier
            candidate_model = EmbeddingLinearClassifier(self.config.categories, embedding_dim=self.config.embedding_dim)
            if baseline_loaded:
                candidate_model.load(baseline_path)
            else:
                candidate_model.initialize()

            train_stats = candidate_model.train(
                X_train,
                y_train,
                epochs=self.config.story_classifier.epochs,
                learning_rate=self.config.story_classifier.learning_rate,
                batch_size=self.config.story_classifier.batch_size,
                weight_decay=0.01,
            )

            candidate_preds = [candidate_model.predict(v.tolist()).label for v in X_eval]
            candidate_metrics = compute_classification_metrics(
                y_eval,
                [p.lower() for p in candidate_preds],
                labels=self.config.categories,
            )

            improvement_f1 = candidate_metrics["macro_f1"] - baseline_metrics["macro_f1"]
            acc_drop = baseline_metrics["accuracy"] - candidate_metrics["accuracy"]
            weighted_f1_drop = baseline_metrics["weighted_f1"] - candidate_metrics["weighted_f1"]

            # Promotion gate: improve macro-F1 without materially regressing overall accuracy.
            promoted = (
                candidate_metrics["support"] >= 20
                and improvement_f1 >= self.config.accuracy_improvement_threshold
                and acc_drop <= 0.01
                and weighted_f1_drop <= 0.01
            )

            candidate_path = models_dir / "embedding_candidate.pt"
            candidate_model.save(candidate_path)

            if promoted:
                candidate_model.save(baseline_path)
                logger.info(
                    f"Promoted {model_type}: macro_f1 {baseline_metrics['macro_f1']:.3f} -> "
                    f"{candidate_metrics['macro_f1']:.3f}"
                )
            else:
                logger.info(
                    f"Did not promote {model_type}: macro_f1 {baseline_metrics['macro_f1']:.3f} -> "
                    f"{candidate_metrics['macro_f1']:.3f} (Δ={improvement_f1:.3f}, acc_drop={acc_drop:.3f})"
                )

            await self.experience_repo.mark_as_used(used_record_ids)

            await self._record_model_version(
                model_type=ModelType.STORY_CLASSIFIER,
                accuracy=candidate_metrics["accuracy"],
                training_samples=len(used_record_ids),
                model_path=baseline_path if promoted else candidate_path,
                promoted=promoted,
                metrics={
                    "macro_f1": candidate_metrics["macro_f1"],
                    "macro_precision": candidate_metrics["macro_precision"],
                    "macro_recall": candidate_metrics["macro_recall"],
                    "baseline_accuracy": baseline_metrics["accuracy"],
                    "baseline_macro_f1": baseline_metrics["macro_f1"],
                    "train_stats": train_stats,
                },
            )

            return TrainingResult(
                model_type=model_type,
                success=True,
                samples_used=len(used_record_ids),
                new_accuracy=candidate_metrics["accuracy"],
                previous_accuracy=baseline_metrics["accuracy"],
                new_metrics=candidate_metrics,
                previous_metrics=baseline_metrics,
                promoted=promoted,
            )

        except Exception as e:
            logger.exception(f"Failed to train {model_type}: {e}")
            return TrainingResult(
                model_type=model_type,
                success=False,
                samples_used=0,
                error=str(e),
            )

    async def _train_priority_bandit(self) -> TrainingResult:
        """Train priority bandit model."""
        model_type = "priority_bandit"
        min_samples = self.config.priority_bandit.min_samples_to_train

        try:
            # Get priority feedback
            records = await self.experience_repo.get_unused_for_training(
                ExperienceType.PRIORITY,
                limit=1000,
            )

            if len(records) < min_samples:
                logger.info(f"Insufficient samples for {model_type}: {len(records)} < {min_samples}")
                return TrainingResult(
                    model_type=model_type,
                    success=True,
                    samples_used=0,
                    promoted=False,
                )

            contexts: list[np.ndarray] = []
            y_true: list[str] = []
            sys_actions: list[str] = []
            used_record_ids: list = []

            for r in records:
                if not r.context_features or not r.human_action:
                    continue
                feats = r.context_features.get("features")
                if not isinstance(feats, list) or not feats:
                    continue

                ctx = np.asarray(feats, dtype=np.float32)
                if ctx.shape[0] < 14:
                    ctx = np.pad(ctx, (0, 14 - ctx.shape[0]))
                elif ctx.shape[0] > 14:
                    ctx = ctx[:14]

                contexts.append(ctx)
                y_true.append(r.human_action.lower())
                sys_actions.append((r.system_action or "medium").lower())
                used_record_ids.append(r.id)

            if len(contexts) < min_samples:
                logger.info(
                    f"Insufficient usable samples for {model_type}: "
                    f"{len(contexts)} with features < {min_samples}"
                )
                return TrainingResult(
                    model_type=model_type,
                    success=True,
                    samples_used=0,
                    promoted=False,
                )

            train_idx, eval_idx = _stratified_train_eval_split(y_true, eval_frac=0.2)

            # Baseline model (current)
            baseline_model = PriorityBandit(
                hidden_dim=self.config.priority_bandit.hidden_dim,
                dropout=self.config.priority_bandit.dropout,
            )
            baseline_model.initialize()

            models_dir = self.config.models_dir / "priority_bandit"
            baseline_path = models_dir / "latest.pt"
            if baseline_path.exists():
                baseline_model.load(baseline_path)

            # Candidate model (train supervised from scratch on human labels)
            candidate_model = PriorityBandit(
                hidden_dim=self.config.priority_bandit.hidden_dim,
                dropout=self.config.priority_bandit.dropout,
            )
            candidate_model.initialize()

            # Supervised training loop (contexts -> human priority)
            import torch
            import torch.nn as nn

            label_to_idx = {p: i for i, p in enumerate(PRIORITIES)}
            y_all = [label_to_idx.get(y, 1) for y in y_true]  # default to 'medium'

            X = np.stack(contexts, axis=0).astype(np.float32, copy=False)
            y = np.asarray(y_all, dtype=np.int64)

            # Class weights (inverse frequency) to avoid collapsing into the majority class.
            counts = np.bincount(y, minlength=len(PRIORITIES)).astype(np.float32)
            total = float(counts.sum()) if counts.sum() else 1.0
            weights = np.where(counts > 0, total / (len(PRIORITIES) * counts), 0.0)
            class_weights = torch.tensor(weights, dtype=torch.float32)

            loss_fn = nn.CrossEntropyLoss(weight=class_weights)
            optimizer = torch.optim.Adam(
                candidate_model.model.parameters(),  # type: ignore[union-attr]
                lr=self.config.priority_bandit.learning_rate,
                weight_decay=1e-4,
            )

            torch.manual_seed(42)
            np.random.seed(42)

            candidate_model.model.train()  # type: ignore[union-attr]
            train_X = torch.from_numpy(X[train_idx])
            train_y = torch.from_numpy(y[train_idx])

            bs = max(4, int(self.config.priority_bandit.batch_size))
            epochs = max(1, int(self.config.priority_bandit.epochs))

            for _epoch in range(epochs):
                perm = torch.randperm(train_X.shape[0])
                for start in range(0, train_X.shape[0], bs):
                    idx = perm[start : start + bs]
                    logits, _log_var = candidate_model.model(train_X[idx])  # type: ignore[union-attr]
                    loss = loss_fn(logits, train_y[idx])
                    optimizer.zero_grad()
                    loss.backward()
                    optimizer.step()

            # Evaluate baseline vs candidate on eval split
            y_eval = [y_true[i] for i in eval_idx]

            baseline_preds = [
                baseline_model.predict(contexts[i], explore=False).priority
                for i in eval_idx
            ]
            candidate_preds = [
                candidate_model.predict(contexts[i], explore=False).priority
                for i in eval_idx
            ]

            baseline_metrics = compute_classification_metrics(y_eval, baseline_preds, labels=PRIORITIES)
            candidate_metrics = compute_classification_metrics(y_eval, candidate_preds, labels=PRIORITIES)
            sys_metrics = compute_classification_metrics(y_eval, [sys_actions[i] for i in eval_idx], labels=PRIORITIES)

            improvement_f1 = candidate_metrics["macro_f1"] - baseline_metrics["macro_f1"]
            acc_drop = baseline_metrics["accuracy"] - candidate_metrics["accuracy"]
            weighted_f1_drop = baseline_metrics["weighted_f1"] - candidate_metrics["weighted_f1"]

            base_focus_recall = (
                baseline_metrics["per_label"].get("high", {}).get("recall", 0.0)
                + baseline_metrics["per_label"].get("critical", {}).get("recall", 0.0)
            ) / 2.0
            cand_focus_recall = (
                candidate_metrics["per_label"].get("high", {}).get("recall", 0.0)
                + candidate_metrics["per_label"].get("critical", {}).get("recall", 0.0)
            ) / 2.0

            promoted = (
                candidate_metrics["support"] >= 20
                and improvement_f1 >= self.config.accuracy_improvement_threshold
                and weighted_f1_drop <= 0.01
                and cand_focus_recall >= base_focus_recall
            )

            candidate_path = models_dir / "candidate.pt"
            candidate_model.save(candidate_path)

            if promoted:
                candidate_model.save(baseline_path)
                logger.info(
                    f"Promoted {model_type}: macro_f1 {baseline_metrics['macro_f1']:.3f} -> "
                    f"{candidate_metrics['macro_f1']:.3f}"
                )
            else:
                logger.info(
                    f"Did not promote {model_type}: macro_f1 {baseline_metrics['macro_f1']:.3f} -> "
                    f"{candidate_metrics['macro_f1']:.3f} (Δ={improvement_f1:.3f}, acc_drop={acc_drop:.3f})"
                )

            await self.experience_repo.mark_as_used(used_record_ids)

            await self._record_model_version(
                model_type=ModelType.PRIORITY_BANDIT,
                accuracy=candidate_metrics["accuracy"],
                training_samples=len(used_record_ids),
                model_path=baseline_path if promoted else candidate_path,
                promoted=promoted,
                metrics={
                    "macro_f1": candidate_metrics["macro_f1"],
                    "macro_precision": candidate_metrics["macro_precision"],
                    "macro_recall": candidate_metrics["macro_recall"],
                    "baseline_accuracy": baseline_metrics["accuracy"],
                    "baseline_macro_f1": baseline_metrics["macro_f1"],
                    "system_accuracy": sys_metrics["accuracy"],
                    "system_macro_f1": sys_metrics["macro_f1"],
                },
            )

            return TrainingResult(
                model_type=model_type,
                success=True,
                samples_used=len(used_record_ids),
                new_accuracy=candidate_metrics["accuracy"],
                previous_accuracy=baseline_metrics["accuracy"],
                new_metrics=candidate_metrics,
                previous_metrics=baseline_metrics,
                promoted=promoted,
            )

        except Exception as e:
            logger.exception(f"Failed to train {model_type}: {e}")
            return TrainingResult(
                model_type=model_type,
                success=False,
                samples_used=0,
                error=str(e),
            )

    async def _train_anomaly_vae(self) -> TrainingResult:
        """Train anomaly VAE model."""
        model_type = "anomaly_vae"
        min_samples = self.config.anomaly_vae.min_samples_to_train

        try:
            # Get anomaly feedback
            records = await self.experience_repo.get_unused_for_training(
                ExperienceType.ANOMALY,
                limit=1000,
            )

            if len(records) < min_samples:
                return TrainingResult(
                    model_type=model_type,
                    success=True,
                    samples_used=0,
                    promoted=False,
                )

            # Initialize model
            model = AnomalyVAE(
                hidden_dim=self.config.anomaly_vae.hidden_dim,
            )
            model.initialize()

            # Load existing weights
            model_path = self.config.models_dir / "anomaly_vae" / "latest.pt"
            if model_path.exists():
                model.load(model_path)

            # Train on normal examples (where system was correct)
            import numpy as np
            normal_features = []
            for record in records:
                if record.context_features and record.reward and float(record.reward) > 0:
                    features = record.context_features.get("features", [])
                    if features:
                        normal_features.append(features)

            if normal_features:
                batch = np.array(normal_features, dtype=np.float32)
                for _ in range(self.config.anomaly_vae.epochs):
                    model.train_step(
                        batch,
                        learning_rate=self.config.anomaly_vae.learning_rate,
                    )

            # Save model
            model_path.parent.mkdir(parents=True, exist_ok=True)
            model.save(model_path)

            # Mark records as used
            record_ids = [r.id for r in records]
            await self.experience_repo.mark_as_used(record_ids)

            await self._record_model_version(
                model_type=ModelType.ANOMALY_VAE,
                accuracy=None,
                training_samples=len(records),
                model_path=model_path,
                promoted=True,
            )

            return TrainingResult(
                model_type=model_type,
                success=True,
                samples_used=len(records),
                promoted=True,
            )

        except Exception as e:
            logger.exception(f"Failed to train {model_type}: {e}")
            return TrainingResult(
                model_type=model_type,
                success=False,
                samples_used=0,
                error=str(e),
            )

    async def _train_temporal_embedder(self) -> TrainingResult:
        """Train temporal embedder model."""
        model_type = "temporal_embedder"
        min_samples = self.config.temporal_embedder.min_samples_to_train

        try:
            # Get temporal/clustering feedback
            records = await self.experience_repo.get_unused_for_training(
                ExperienceType.TEMPORAL,
                limit=1000,
            )

            if len(records) < min_samples:
                return TrainingResult(
                    model_type=model_type,
                    success=True,
                    samples_used=0,
                    promoted=False,
                )

            # Initialize model
            model = TemporalEmbedder(
                hidden_dim=self.config.temporal_embedder.hidden_dim,
            )
            model.initialize()

            # Load existing weights
            model_path = self.config.models_dir / "temporal_embedder" / "latest.pt"
            if model_path.exists():
                model.load(model_path)

            # Build training pairs from feedback
            positive_pairs = []
            negative_pairs = []

            for record in records:
                if record.context_features:
                    seq1 = record.context_features.get("seq1", [])
                    seq2 = record.context_features.get("seq2", [])
                    if seq1 and seq2:
                        if record.reward and float(record.reward) > 0:
                            positive_pairs.append((seq1, seq2))
                        else:
                            negative_pairs.append((seq1, seq2))

            if positive_pairs or negative_pairs:
                model.train_step(
                    positive_pairs,
                    negative_pairs,
                    learning_rate=self.config.temporal_embedder.learning_rate,
                )

            # Save model
            model_path.parent.mkdir(parents=True, exist_ok=True)
            model.save(model_path)

            # Mark records as used
            record_ids = [r.id for r in records]
            await self.experience_repo.mark_as_used(record_ids)

            await self._record_model_version(
                model_type=ModelType.TEMPORAL_EMBEDDER,
                accuracy=None,
                training_samples=len(records),
                model_path=model_path,
                promoted=True,
            )

            return TrainingResult(
                model_type=model_type,
                success=True,
                samples_used=len(records),
                promoted=True,
            )

        except Exception as e:
            logger.exception(f"Failed to train {model_type}: {e}")
            return TrainingResult(
                model_type=model_type,
                success=False,
                samples_used=0,
                error=str(e),
            )

    async def _record_model_version(
        self,
        model_type: str,
        accuracy: Optional[float],
        training_samples: int,
        model_path: Optional[Path] = None,
        promoted: bool = False,
        metrics: Optional[dict] = None,
    ):
        """Record a new model version in the database."""
        from decimal import Decimal

        version = RLModelVersion(
            id=uuid4(),
            model_type=model_type,
            version=datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S"),
            accuracy=Decimal(str(accuracy)) if accuracy else None,
            is_active=promoted,
            model_path=str(model_path) if model_path else None,
            training_samples=training_samples,
            model_metadata={
                "trained_at": datetime.now(timezone.utc).isoformat(),
                **(metrics or {}),
            },
        )

        if promoted:
            await self.db.execute(
                update(RLModelVersion)
                .where(RLModelVersion.model_type == model_type)
                .values(is_active=False)
            )

        self.db.add(version)
        await self.db.commit()

    async def get_training_stats(self) -> Dict:
        """Get training statistics."""
        experience_stats = await self.experience_repo.get_stats()

        return {
            "experience_buffer": experience_stats,
            "ready_for_training": {
                model_type: count >= getattr(
                    self.config, model_type.replace("_", "_"), self.config.story_classifier
                ).min_samples_to_train
                for model_type, count in experience_stats.get("unused_by_type", {}).items()
            },
        }
