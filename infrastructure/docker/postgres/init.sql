-- PostgreSQL initialization script for Nepal OSINT Platform
-- Military-grade intelligence system with Palantir-like capabilities

-- ============================================================================
-- EXTENSIONS
-- ============================================================================

-- Vector embeddings for semantic search (pgvector)
CREATE EXTENSION IF NOT EXISTS vector;

-- Trigram extension for fuzzy text search (Nepali romanization variants)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Geospatial support for Nepal districts and locations
-- PostGIS is optional - only create if available
DO $$
BEGIN
    CREATE EXTENSION IF NOT EXISTS postgis;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'PostGIS extension not available, skipping. Install postgis for geospatial features.';
END $$;

-- Grant permissions
GRANT ALL PRIVILEGES ON DATABASE nepal_osint TO nepal_osint;

-- ============================================================================
-- LAYER 1: RAW STORE (Immutable Content-Addressed Storage)
-- ============================================================================

CREATE TABLE IF NOT EXISTS raw_documents (
    doc_hash VARCHAR(64) PRIMARY KEY,
    source_id VARCHAR(100) NOT NULL,
    url TEXT NOT NULL,
    fetched_at TIMESTAMPTZ NOT NULL,
    raw_content BYTEA NOT NULL,
    content_type VARCHAR(100) NOT NULL DEFAULT 'text/html',
    extraction_version VARCHAR(20) NOT NULL,
    headers JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_raw_url_fetched UNIQUE (url, fetched_at)
);

CREATE INDEX IF NOT EXISTS idx_raw_source_id ON raw_documents(source_id);
CREATE INDEX IF NOT EXISTS idx_raw_fetched_at ON raw_documents(fetched_at DESC);
CREATE INDEX IF NOT EXISTS idx_raw_url ON raw_documents USING HASH(url);

-- ============================================================================
-- LAYER 2: NORMALIZED STORE (Parsed Documents with FTS)
-- ============================================================================

CREATE TABLE IF NOT EXISTS documents (
    doc_id VARCHAR(64) PRIMARY KEY,
    doc_hash VARCHAR(64) REFERENCES raw_documents(doc_hash),
    source_id VARCHAR(100) NOT NULL,
    source_name VARCHAR(255),
    url TEXT NOT NULL UNIQUE,

    -- Bilingual content (English + Nepali)
    title TEXT NOT NULL,
    title_ne TEXT,
    content TEXT,
    content_ne TEXT,
    summary TEXT,
    language VARCHAR(10) DEFAULT 'unknown',

    -- Metadata
    author VARCHAR(255),
    published_at TIMESTAMPTZ,
    scraped_at TIMESTAMPTZ,
    category VARCHAR(100),
    tags JSONB DEFAULT '[]',

    -- Processing status
    status VARCHAR(20) DEFAULT 'pending',
    processed_at TIMESTAMPTZ,
    processing_version VARCHAR(20),
    error_message TEXT,

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Full-text search vector (separate column for flexibility)
ALTER TABLE documents ADD COLUMN IF NOT EXISTS search_vector TSVECTOR;

-- Create trigger function for search vector update
CREATE OR REPLACE FUNCTION update_document_search_vector()
RETURNS TRIGGER AS $$
BEGIN
    NEW.search_vector :=
        setweight(to_tsvector('english', COALESCE(NEW.title, '')), 'A') ||
        setweight(to_tsvector('simple', COALESCE(NEW.title_ne, '')), 'A') ||
        setweight(to_tsvector('english', COALESCE(NEW.content, '')), 'B') ||
        setweight(to_tsvector('simple', COALESCE(NEW.content_ne, '')), 'B') ||
        setweight(to_tsvector('english', COALESCE(NEW.summary, '')), 'C');
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger
DROP TRIGGER IF EXISTS trigger_update_document_search_vector ON documents;
CREATE TRIGGER trigger_update_document_search_vector
    BEFORE INSERT OR UPDATE ON documents
    FOR EACH ROW EXECUTE FUNCTION update_document_search_vector();

-- Indexes for documents
CREATE INDEX IF NOT EXISTS idx_documents_search ON documents USING GIN(search_vector);
CREATE INDEX IF NOT EXISTS idx_documents_source ON documents(source_id);
CREATE INDEX IF NOT EXISTS idx_documents_published ON documents(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status);
CREATE INDEX IF NOT EXISTS idx_documents_category ON documents(category);
CREATE INDEX IF NOT EXISTS idx_documents_title_trgm ON documents USING GIN(title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_documents_title_ne_trgm ON documents USING GIN(title_ne gin_trgm_ops);

-- ============================================================================
-- LAYER 3: FEATURE STORE (ML Features and Embeddings)
-- ============================================================================

-- Vector embeddings using pgvector
CREATE TABLE IF NOT EXISTS embeddings (
    doc_id VARCHAR(64) NOT NULL,
    embedding_type VARCHAR(50) NOT NULL,
    embedding vector(768),
    model_name VARCHAR(100),
    model_version VARCHAR(20),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (doc_id, embedding_type),
    CONSTRAINT fk_embeddings_doc FOREIGN KEY (doc_id)
        REFERENCES documents(doc_id) ON DELETE CASCADE
);

-- HNSW index for fast approximate nearest neighbor search
CREATE INDEX IF NOT EXISTS idx_embeddings_vector ON embeddings
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

-- Entity mentions with positions
CREATE TABLE IF NOT EXISTS entity_mentions (
    mention_id VARCHAR(64) PRIMARY KEY,
    doc_id VARCHAR(64) NOT NULL REFERENCES documents(doc_id) ON DELETE CASCADE,
    entity_id VARCHAR(64),
    mention_text TEXT NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    start_offset INTEGER,
    end_offset INTEGER,
    confidence NUMERIC(5,4),
    normalized_text TEXT,
    model_version VARCHAR(20),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mentions_doc ON entity_mentions(doc_id);
CREATE INDEX IF NOT EXISTS idx_mentions_entity ON entity_mentions(entity_id);
CREATE INDEX IF NOT EXISTS idx_mentions_type ON entity_mentions(entity_type);
CREATE INDEX IF NOT EXISTS idx_mentions_text_trgm ON entity_mentions USING GIN(mention_text gin_trgm_ops);

-- Event frames (5W structure)
CREATE TABLE IF NOT EXISTS event_frames (
    frame_id VARCHAR(64) PRIMARY KEY,
    doc_id VARCHAR(64) NOT NULL REFERENCES documents(doc_id) ON DELETE CASCADE,
    event_type VARCHAR(100) NOT NULL,
    what_happened TEXT,
    where_location TEXT,
    when_time TEXT,
    who_actor TEXT,
    who_affected TEXT,
    severity VARCHAR(20),
    certainty VARCHAR(20),
    evidence_span TEXT,
    evidence_start INTEGER,
    evidence_end INTEGER,
    confidence NUMERIC(5,4),
    model_version VARCHAR(20),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_events_doc ON event_frames(doc_id);
CREATE INDEX IF NOT EXISTS idx_events_type ON event_frames(event_type);
CREATE INDEX IF NOT EXISTS idx_events_severity ON event_frames(severity);
CREATE INDEX IF NOT EXISTS idx_events_created ON event_frames(created_at DESC);

-- Sentiment and stance analysis
CREATE TABLE IF NOT EXISTS sentiment_stance (
    doc_id VARCHAR(64) NOT NULL,
    target_entity VARCHAR(64) NOT NULL,
    sentiment_score NUMERIC(5,4),
    stance_label VARCHAR(20),
    confidence NUMERIC(5,4),
    model_version VARCHAR(20),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (doc_id, target_entity),
    CONSTRAINT fk_sentiment_doc FOREIGN KEY (doc_id)
        REFERENCES documents(doc_id) ON DELETE CASCADE
);

-- Topic vectors
CREATE TABLE IF NOT EXISTS topic_vectors (
    doc_id VARCHAR(64) PRIMARY KEY REFERENCES documents(doc_id) ON DELETE CASCADE,
    topics JSONB NOT NULL,
    dominant_topic VARCHAR(100),
    model_version VARCHAR(20),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Story clusters
CREATE TABLE IF NOT EXISTS story_clusters (
    cluster_id VARCHAR(64) NOT NULL,
    doc_id VARCHAR(64) NOT NULL REFERENCES documents(doc_id) ON DELETE CASCADE,
    similarity_score NUMERIC(5,4),
    cluster_label TEXT,
    model_version VARCHAR(20),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (cluster_id, doc_id)
);

CREATE INDEX IF NOT EXISTS idx_clusters_doc ON story_clusters(doc_id);

-- ============================================================================
-- LAYER 4: GRAPH STORE (Evidence-First Knowledge Graph)
-- ============================================================================

-- Core entities
CREATE TABLE IF NOT EXISTS entities (
    entity_id VARCHAR(64) PRIMARY KEY,
    canonical_id VARCHAR(64) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    canonical_name TEXT NOT NULL,
    canonical_name_ne TEXT,
    attributes JSONB DEFAULT '{}',
    confidence_score NUMERIC(5,4) DEFAULT 0.5,
    evidence_count INTEGER DEFAULT 0,
    model_version VARCHAR(20),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Entity search vector
ALTER TABLE entities ADD COLUMN IF NOT EXISTS search_vector TSVECTOR;

CREATE OR REPLACE FUNCTION update_entity_search_vector()
RETURNS TRIGGER AS $$
BEGIN
    NEW.search_vector :=
        setweight(to_tsvector('english', COALESCE(NEW.canonical_name, '')), 'A') ||
        setweight(to_tsvector('simple', COALESCE(NEW.canonical_name_ne, '')), 'A');
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_entity_search_vector ON entities;
CREATE TRIGGER trigger_update_entity_search_vector
    BEFORE INSERT OR UPDATE ON entities
    FOR EACH ROW EXECUTE FUNCTION update_entity_search_vector();

CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(entity_type);
CREATE INDEX IF NOT EXISTS idx_entities_canonical ON entities(canonical_id);
CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(canonical_name);
CREATE INDEX IF NOT EXISTS idx_entities_search ON entities USING GIN(search_vector);
CREATE INDEX IF NOT EXISTS idx_entities_name_trgm ON entities USING GIN(canonical_name gin_trgm_ops);

-- Entity aliases (cross-lingual)
CREATE TABLE IF NOT EXISTS entity_aliases (
    alias_id VARCHAR(64) PRIMARY KEY,
    entity_id VARCHAR(64) NOT NULL REFERENCES entities(entity_id) ON DELETE CASCADE,
    alias_text TEXT NOT NULL,
    alias_lang VARCHAR(10),
    alias_script VARCHAR(20),
    alias_kind VARCHAR(50),
    source TEXT,
    weight NUMERIC(5,4) DEFAULT 1.0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_entity_alias UNIQUE (entity_id, alias_text)
);

CREATE INDEX IF NOT EXISTS idx_aliases_entity ON entity_aliases(entity_id);
CREATE INDEX IF NOT EXISTS idx_aliases_text ON entity_aliases(alias_text);
CREATE INDEX IF NOT EXISTS idx_aliases_text_trgm ON entity_aliases USING GIN(alias_text gin_trgm_ops);

-- Evidence-backed relationships (NO EDGE WITHOUT EVIDENCE)
CREATE TABLE IF NOT EXISTS relationships (
    rel_id VARCHAR(64) PRIMARY KEY,
    source_entity_id VARCHAR(64) NOT NULL REFERENCES entities(entity_id) ON DELETE CASCADE,
    target_entity_id VARCHAR(64) NOT NULL REFERENCES entities(entity_id) ON DELETE CASCADE,
    rel_type VARCHAR(50) NOT NULL,
    evidence_doc_id VARCHAR(64) NOT NULL REFERENCES documents(doc_id) ON DELETE CASCADE,
    evidence_quote TEXT NOT NULL,
    evidence_start_offset INTEGER,
    evidence_end_offset INTEGER,
    valid_from TIMESTAMPTZ,
    valid_until TIMESTAMPTZ,
    confidence NUMERIC(5,4) DEFAULT 0.5,
    model_version VARCHAR(20),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rel_source ON relationships(source_entity_id);
CREATE INDEX IF NOT EXISTS idx_rel_target ON relationships(target_entity_id);
CREATE INDEX IF NOT EXISTS idx_rel_entities ON relationships(source_entity_id, target_entity_id);
CREATE INDEX IF NOT EXISTS idx_rel_type ON relationships(rel_type);
CREATE INDEX IF NOT EXISTS idx_rel_evidence ON relationships(evidence_doc_id);

-- Entity resolution audit log
CREATE TABLE IF NOT EXISTS resolution_log (
    log_id VARCHAR(64) PRIMARY KEY,
    action VARCHAR(50) NOT NULL,
    entity_ids JSONB NOT NULL,
    reason TEXT,
    performed_by VARCHAR(50) NOT NULL,
    metadata JSONB DEFAULT '{}',
    performed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_log_action ON resolution_log(action);
CREATE INDEX IF NOT EXISTS idx_log_performed ON resolution_log(performed_at DESC);
CREATE INDEX IF NOT EXISTS idx_log_entities ON resolution_log USING GIN(entity_ids);

-- ============================================================================
-- LLM INTEGRATION TABLES
-- ============================================================================

-- LLM processing audit log
CREATE TABLE IF NOT EXISTS llm_processing_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    entity_id VARCHAR(64) REFERENCES entities(entity_id) ON DELETE SET NULL,
    doc_id VARCHAR(64) REFERENCES documents(doc_id) ON DELETE SET NULL,
    task_type VARCHAR(50) NOT NULL,
    model_used VARCHAR(100) NOT NULL,
    prompt_hash VARCHAR(64),
    input_text TEXT,
    output_json JSONB,
    confidence NUMERIC(4,3),
    tokens_used INTEGER,
    processing_time_ms INTEGER,
    cached BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_llm_log_doc ON llm_processing_log(doc_id);
CREATE INDEX IF NOT EXISTS idx_llm_log_task ON llm_processing_log(task_type);
CREATE INDEX IF NOT EXISTS idx_llm_log_created ON llm_processing_log(created_at);

-- LLM-inferred relationships (separate from pattern-based)
CREATE TABLE IF NOT EXISTS llm_relationships (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source_entity_id VARCHAR(64) REFERENCES entities(entity_id) ON DELETE CASCADE,
    target_entity_id VARCHAR(64) REFERENCES entities(entity_id) ON DELETE CASCADE,
    relation_type VARCHAR(50) NOT NULL,
    confidence NUMERIC(4,3) NOT NULL,
    evidence_text TEXT,
    reasoning TEXT,
    model_used VARCHAR(100) NOT NULL,
    verified_by_human BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(source_entity_id, target_entity_id, relation_type)
);

CREATE INDEX IF NOT EXISTS idx_llm_rel_source ON llm_relationships(source_entity_id);
CREATE INDEX IF NOT EXISTS idx_llm_rel_target ON llm_relationships(target_entity_id);

-- Natural language query log
CREATE TABLE IF NOT EXISTS nl_query_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    original_query TEXT NOT NULL,
    language VARCHAR(10) DEFAULT 'en',
    interpreted_query TEXT,
    generated_cypher TEXT,
    generated_sql TEXT,
    result_count INTEGER,
    execution_time_ms INTEGER,
    model_used VARCHAR(100),
    confidence NUMERIC(4,3),
    feedback_rating INTEGER,
    feedback_text TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_nl_query_created ON nl_query_log(created_at);

-- ============================================================================
-- ML PREDICTION TABLES
-- ============================================================================

-- Entity features for ML
CREATE TABLE IF NOT EXISTS entity_features (
    entity_id VARCHAR(64) PRIMARY KEY REFERENCES entities(entity_id) ON DELETE CASCADE,
    feature_vector JSONB NOT NULL,
    graph_embedding vector(128),
    computed_at TIMESTAMPTZ DEFAULT NOW(),
    model_version VARCHAR(50)
);

CREATE INDEX IF NOT EXISTS idx_entity_features_embedding ON entity_features
    USING hnsw (graph_embedding vector_cosine_ops);

-- Location features for ML
CREATE TABLE IF NOT EXISTS location_features (
    district_name VARCHAR(100) PRIMARY KEY,
    feature_vector JSONB NOT NULL,
    computed_at TIMESTAMPTZ DEFAULT NOW()
);

-- Event predictions
CREATE TABLE IF NOT EXISTS event_predictions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_type VARCHAR(100) NOT NULL,
    location VARCHAR(100),
    probability NUMERIC(4,3) NOT NULL,
    prediction_window_start TIMESTAMPTZ NOT NULL,
    prediction_window_end TIMESTAMPTZ NOT NULL,
    supporting_indicators JSONB,
    model_version VARCHAR(50) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    realized BOOLEAN DEFAULT NULL,
    realized_event_id UUID
);

CREATE INDEX IF NOT EXISTS idx_predictions_window ON event_predictions(prediction_window_start, prediction_window_end);
CREATE INDEX IF NOT EXISTS idx_predictions_type ON event_predictions(event_type);

-- Link predictions
CREATE TABLE IF NOT EXISTS link_predictions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source_entity_id VARCHAR(64) REFERENCES entities(entity_id) ON DELETE CASCADE,
    target_entity_id VARCHAR(64) REFERENCES entities(entity_id) ON DELETE CASCADE,
    predicted_relationship VARCHAR(100) NOT NULL,
    score NUMERIC(4,3) NOT NULL,
    explanation JSONB,
    model_version VARCHAR(50) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    validated BOOLEAN DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_link_predictions_score ON link_predictions(score DESC);

-- Temporal patterns
CREATE TABLE IF NOT EXISTS detected_patterns (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    pattern_type VARCHAR(50) NOT NULL,
    event_type VARCHAR(100),
    location VARCHAR(100),
    period_days INTEGER,
    confidence NUMERIC(4,3) NOT NULL,
    last_occurrence TIMESTAMPTZ,
    next_predicted TIMESTAMPTZ,
    pattern_data JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- SEARCH HELPER FUNCTIONS
-- ============================================================================

-- Full-text search with ranking
CREATE OR REPLACE FUNCTION search_documents(
    query_text TEXT,
    source_filter TEXT DEFAULT NULL,
    since_date TIMESTAMPTZ DEFAULT NULL,
    result_limit INTEGER DEFAULT 50
)
RETURNS TABLE (
    doc_id VARCHAR,
    title TEXT,
    url TEXT,
    published_at TIMESTAMPTZ,
    rank REAL
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        d.doc_id,
        d.title,
        d.url,
        d.published_at,
        ts_rank(d.search_vector, websearch_to_tsquery('english', query_text)) AS rank
    FROM documents d
    WHERE d.search_vector @@ websearch_to_tsquery('english', query_text)
      AND (source_filter IS NULL OR d.source_id = source_filter)
      AND (since_date IS NULL OR d.published_at >= since_date)
    ORDER BY rank DESC, d.published_at DESC
    LIMIT result_limit;
END;
$$ LANGUAGE plpgsql;

-- Fuzzy entity search (handles Nepali romanization variants)
CREATE OR REPLACE FUNCTION fuzzy_search_entities(
    query_text TEXT,
    entity_type_filter TEXT DEFAULT NULL,
    similarity_threshold REAL DEFAULT 0.3
)
RETURNS TABLE (
    entity_id VARCHAR,
    canonical_name TEXT,
    entity_type VARCHAR,
    similarity REAL
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        e.entity_id,
        e.canonical_name,
        e.entity_type,
        GREATEST(
            similarity(e.canonical_name, query_text),
            COALESCE(similarity(e.canonical_name_ne, query_text), 0)
        ) AS similarity
    FROM entities e
    WHERE (
        e.canonical_name % query_text
        OR e.canonical_name_ne % query_text
    )
    AND (entity_type_filter IS NULL OR e.entity_type = entity_type_filter)
    AND GREATEST(
        similarity(e.canonical_name, query_text),
        COALESCE(similarity(e.canonical_name_ne, query_text), 0)
    ) >= similarity_threshold
    ORDER BY similarity DESC
    LIMIT 20;
END;
$$ LANGUAGE plpgsql;

-- Vector similarity search for documents
CREATE OR REPLACE FUNCTION find_similar_documents(
    query_embedding vector(768),
    top_k INTEGER DEFAULT 10,
    min_similarity REAL DEFAULT 0.7
)
RETURNS TABLE (
    doc_id VARCHAR,
    title TEXT,
    similarity REAL
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        d.doc_id,
        d.title,
        (1 - (e.embedding <=> query_embedding))::REAL AS similarity
    FROM documents d
    JOIN embeddings e ON d.doc_id = e.doc_id
    WHERE e.embedding_type = 'document'
      AND (1 - (e.embedding <=> query_embedding)) >= min_similarity
    ORDER BY e.embedding <=> query_embedding
    LIMIT top_k;
END;
$$ LANGUAGE plpgsql;
