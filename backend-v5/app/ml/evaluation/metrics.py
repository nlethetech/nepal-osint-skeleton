"""Lightweight classification metrics (no sklearn dependency)."""

from __future__ import annotations

from collections import defaultdict
from typing import Iterable, Optional


def _safe_div(n: float, d: float) -> float:
    return float(n / d) if d else 0.0


def compute_classification_metrics(
    y_true: list[str],
    y_pred: list[str],
    *,
    labels: Optional[list[str]] = None,
) -> dict:
    """
    Compute accuracy, macro precision/recall/F1, and per-label stats.

    Args:
        y_true: Ground truth labels
        y_pred: Predicted labels
        labels: Optional fixed label set (controls macro averaging + report order)

    Returns:
        Dict with keys: support, accuracy, macro_precision, macro_recall, macro_f1, per_label
    """
    if len(y_true) != len(y_pred):
        raise ValueError("y_true and y_pred must have the same length")

    support = len(y_true)
    if support == 0:
        return {
            "support": 0,
            "accuracy": 0.0,
            "macro_precision": 0.0,
            "macro_recall": 0.0,
            "macro_f1": 0.0,
            "per_label": {},
        }

    label_set: list[str]
    if labels is not None:
        label_set = list(labels)
    else:
        label_set = sorted(set(y_true) | set(y_pred))

    tp = defaultdict(int)
    fp = defaultdict(int)
    fn = defaultdict(int)
    true_counts = defaultdict(int)

    correct = 0
    for t, p in zip(y_true, y_pred):
        true_counts[t] += 1
        if t == p:
            correct += 1
            tp[t] += 1
        else:
            fp[p] += 1
            fn[t] += 1

    per_label = {}
    precisions: list[float] = []
    recalls: list[float] = []
    f1s: list[float] = []

    for lab in label_set:
        lab_tp = tp[lab]
        lab_fp = fp[lab]
        lab_fn = fn[lab]

        precision = _safe_div(lab_tp, lab_tp + lab_fp)
        recall = _safe_div(lab_tp, lab_tp + lab_fn)
        f1 = _safe_div(2 * precision * recall, precision + recall)

        per_label[lab] = {
            "support": true_counts.get(lab, 0),
            "tp": lab_tp,
            "fp": lab_fp,
            "fn": lab_fn,
            "precision": precision,
            "recall": recall,
            "f1": f1,
        }

        precisions.append(precision)
        recalls.append(recall)
        f1s.append(f1)

    weighted_precision = 0.0
    weighted_recall = 0.0
    weighted_f1 = 0.0
    for lab in label_set:
        w = float(true_counts.get(lab, 0))
        if w <= 0:
            continue
        weighted_precision += per_label[lab]["precision"] * w
        weighted_recall += per_label[lab]["recall"] * w
        weighted_f1 += per_label[lab]["f1"] * w

    total_w = float(support)

    return {
        "support": support,
        "accuracy": float(correct / support),
        "macro_precision": float(sum(precisions) / len(precisions)) if precisions else 0.0,
        "macro_recall": float(sum(recalls) / len(recalls)) if recalls else 0.0,
        "macro_f1": float(sum(f1s) / len(f1s)) if f1s else 0.0,
        "weighted_precision": _safe_div(weighted_precision, total_w),
        "weighted_recall": _safe_div(weighted_recall, total_w),
        "weighted_f1": _safe_div(weighted_f1, total_w),
        "per_label": per_label,
    }
