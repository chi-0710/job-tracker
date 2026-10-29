-- 求职记录 v1：用户、公司、岗位、进展事件
create table app_user (
    id uuid primary key,
    email varchar(255) not null,
    password_hash varchar(100) not null,
    display_name varchar(100) not null default '',
    created_at timestamp with time zone not null,
    updated_at timestamp with time zone not null
);
create unique index uq_app_user_email on app_user (lower(email));

create table company (
    id uuid primary key,
    user_id uuid not null references app_user (id),
    name varchar(200) not null,
    location varchar(200) not null default '',
    company_type varchar(16) not null default '',
    note varchar(2000) not null default '',
    created_at timestamp with time zone not null,
    updated_at timestamp with time zone not null,
    deleted_at timestamp with time zone,
    version bigint not null default 0,
    constraint ck_company_type check (company_type in ('', 'private', 'state'))
);
create index idx_company_user on company (user_id, updated_at desc) where deleted_at is null;

create table position (
    id uuid primary key,
    company_id uuid not null references company (id),
    user_id uuid not null references app_user (id),
    title varchar(200) not null,
    salary varchar(100) not null default '',
    channel varchar(100) not null default '',
    applied_on date,
    status varchar(16) not null default 'pending',
    note varchar(10000) not null default '',
    interview_prep varchar(10000) not null default '',
    experience_summary varchar(10000) not null default '',
    created_at timestamp with time zone not null,
    updated_at timestamp with time zone not null,
    deleted_at timestamp with time zone,
    version bigint not null default 0,
    constraint ck_position_status check (status in ('pending', 'applied', 'interviewing', 'offer', 'rejected', 'failed'))
);
create index idx_position_company on position (company_id) where deleted_at is null;
create index idx_position_user_status on position (user_id, status) where deleted_at is null;
create index idx_position_user_applied on position (user_id, applied_on) where deleted_at is null;

create table timeline_event (
    id uuid primary key,
    position_id uuid not null references position (id),
    occurred_on date not null,
    stage varchar(24) not null default 'other',
    result varchar(16) not null default '',
    note varchar(2000) not null default '',
    created_at timestamp with time zone not null,
    constraint ck_event_stage check (stage in (
        'application', 'screening', 'writtenTest', 'firstInterview',
        'secondInterview', 'finalInterview', 'offer', 'other'
    )),
    constraint ck_event_result check (result in ('', 'pending', 'passed', 'failed', 'cancelled'))
);
create index idx_event_position_date on timeline_event (position_id, occurred_on);
