BEGIN;

CREATE TABLE IF NOT EXISTS public.confgive (
    id            BIGSERIAL    PRIMARY KEY,
    name          TEXT         NOT NULL,
    amount        INTEGER      NOT NULL,
    currency      VARCHAR(3)   NOT NULL,
    "date"        TIMESTAMPTZ  NOT NULL,                -- date 是型別名，欄位名加引號避免混淆
    phone_number  VARCHAR(32)  NOT NULL,
    email         TEXT,
    receipt       BOOLEAN      DEFAULT FALSE,
    paymenttype   TEXT,                                 -- 未加引號時，paymentType 會被轉成小寫 paymenttype（Postgres 規則）
    upload        TEXT,
    receiptname   TEXT,
    nationalid    TEXT,
    company       TEXT,
    taxid         TEXT,
    note          TEXT,
    campus        TEXT,
    tp_trade_id   TEXT         NOT NULL,
    is_success    BOOLEAN      NOT NULL DEFAULT FALSE,
    env           VARCHAR(16)  NOT NULL DEFAULT 'sandbox' CHECK (env IN ('sandbox','production')),
    imported      BOOLEAN      NOT NULL DEFAULT FALSE,
    siyuan_id     TEXT,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- 你原本像是想建索引；這裡補成可執行的語法
CREATE INDEX IF NOT EXISTS confgive_tp_trade_id_idx ON public.confgive (tp_trade_id);

-- Shared, named date ranges used to filter the stats dashboard.
CREATE TABLE IF NOT EXISTS public.stats_events (
    id          BIGSERIAL PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    start_date  DATE NOT NULL,
    end_date    DATE NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (start_date <= end_date)
);

CREATE INDEX IF NOT EXISTS stats_events_latest_idx
  ON public.stats_events (end_date DESC, start_date DESC);

ALTER TABLE public.confgive
  ADD COLUMN IF NOT EXISTS campus TEXT,
  ADD COLUMN IF NOT EXISTS imported BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS siyuan_id TEXT, -- text identifier from Siyuan, it is TEXT and NOT INTEGER
  ALTER COLUMN "date" TYPE TIMESTAMPTZ USING "date"::timestamptz;

COMMIT;
