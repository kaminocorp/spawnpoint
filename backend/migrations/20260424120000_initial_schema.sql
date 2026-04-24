-- +goose Up
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE organizations (
    id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    name       TEXT        NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
    id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    auth_user_id UUID        NOT NULL UNIQUE,
    email        TEXT        NOT NULL UNIQUE,
    org_id       UUID        NOT NULL REFERENCES organizations(id),
    role         TEXT        NOT NULL DEFAULT 'admin',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed a default org for v1 (single-tenant assumption).
INSERT INTO organizations (id, name)
VALUES ('00000000-0000-0000-0000-000000000001', 'Default Org');

-- +goose Down
DROP TABLE users;
DROP TABLE organizations;
DROP EXTENSION IF EXISTS "uuid-ossp";
