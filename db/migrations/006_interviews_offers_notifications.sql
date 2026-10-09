-- 006: Interviews, offers and in-app notifications.

CREATE TABLE IF NOT EXISTS interviews (
    interview_id      BIGINT GENERATED ALWAYS AS IDENTITY,
    application_id    BIGINT       NOT NULL,
    round_no          SMALLINT     NOT NULL,
    scheduled_at      TIMESTAMPTZ  NOT NULL,
    duration_minutes  SMALLINT     NOT NULL DEFAULT 45,
    mode              VARCHAR(10)  NOT NULL DEFAULT 'video',
    location_or_link  VARCHAR(500),
    interviewer_id    BIGINT,
    status            VARCHAR(12)  NOT NULL DEFAULT 'scheduled',
    rating            SMALLINT,
    feedback          TEXT,
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT interviews_pkey PRIMARY KEY (interview_id),
    -- Round numbers are unique within one application.
    CONSTRAINT interviews_application_id_round_no_key UNIQUE (application_id, round_no),
    CONSTRAINT interviews_round_no_check CHECK (round_no BETWEEN 1 AND 10),
    CONSTRAINT interviews_duration_check CHECK (duration_minutes BETWEEN 15 AND 480),
    CONSTRAINT interviews_mode_check CHECK (mode IN ('video', 'phone', 'onsite')),
    CONSTRAINT interviews_status_check CHECK (status IN
        ('scheduled', 'completed', 'cancelled', 'no_show')),
    CONSTRAINT interviews_rating_check CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
    -- A rating only makes sense after the interview has happened.
    CONSTRAINT interviews_rating_requires_completed_check CHECK (
        rating IS NULL OR status = 'completed'),
    CONSTRAINT interviews_application_fkey FOREIGN KEY (application_id)
        REFERENCES applications (application_id) ON DELETE CASCADE,
    CONSTRAINT interviews_interviewer_fkey FOREIGN KEY (interviewer_id)
        REFERENCES recruiters (user_id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS offers (
    offer_id        BIGINT GENERATED ALWAYS AS IDENTITY,
    application_id  BIGINT        NOT NULL,
    salary_offered  NUMERIC(12,2) NOT NULL,
    currency        CHAR(3)       NOT NULL DEFAULT 'INR',
    joining_date    DATE          NOT NULL,
    expires_on      DATE,
    status          VARCHAR(10)   NOT NULL DEFAULT 'pending',
    offered_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
    responded_at    TIMESTAMPTZ,

    CONSTRAINT offers_pkey PRIMARY KEY (offer_id),
    -- One offer per application.
    CONSTRAINT offers_application_id_key UNIQUE (application_id),
    CONSTRAINT offers_salary_check CHECK (salary_offered > 0),
    CONSTRAINT offers_currency_check CHECK (currency ~ '^[A-Z]{3}$'),
    CONSTRAINT offers_status_check CHECK (status IN ('pending', 'accepted', 'declined', 'withdrawn')),
    -- The offer must expire on or before the joining date.
    CONSTRAINT offers_expiry_before_joining_check CHECK (
        expires_on IS NULL OR expires_on <= joining_date),
    -- A pending offer has no response time; a responded offer must have one.
    CONSTRAINT offers_response_consistency_check CHECK (
        (status = 'pending') = (responded_at IS NULL) OR status = 'withdrawn'),
    CONSTRAINT offers_application_fkey FOREIGN KEY (application_id)
        REFERENCES applications (application_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS notifications (
    notification_id         BIGINT GENERATED ALWAYS AS IDENTITY,
    user_id                 BIGINT       NOT NULL,
    type                    VARCHAR(30)  NOT NULL,
    title                   VARCHAR(150) NOT NULL,
    message                 TEXT         NOT NULL,
    related_application_id  BIGINT,
    is_read                 BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at              TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT notifications_pkey PRIMARY KEY (notification_id),
    CONSTRAINT notifications_type_check CHECK (type IN
        ('application_submitted', 'status_changed', 'interview_scheduled', 'offer_made', 'system')),
    CONSTRAINT notifications_title_not_blank_check CHECK (btrim(title) <> ''),
    CONSTRAINT notifications_user_fkey FOREIGN KEY (user_id)
        REFERENCES users (user_id) ON DELETE CASCADE,
    -- Keep the notification text even if the application is later removed.
    CONSTRAINT notifications_application_fkey FOREIGN KEY (related_application_id)
        REFERENCES applications (application_id) ON DELETE SET NULL
);
