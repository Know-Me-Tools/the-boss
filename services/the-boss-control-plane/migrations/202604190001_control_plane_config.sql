create extension if not exists pgcrypto;

create table if not exists control_plane_config (
    id boolean primary key default true,
    revision bigint not null default 1,
    config jsonb not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint control_plane_config_singleton check (id)
);

create table if not exists control_plane_config_audit (
    id uuid primary key default gen_random_uuid(),
    revision bigint not null,
    actor text not null,
    changes jsonb not null,
    created_at timestamptz not null default now()
);
