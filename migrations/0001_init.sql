-- ライセンスキーと Stripe イベントの冪等化テーブル。
-- 日時はすべて Unix 秒（UTC）。比較しやすく、タイムゾーンの混乱を避けるため。

CREATE TABLE IF NOT EXISTS licenses (
  key             TEXT PRIMARY KEY,                 -- 例: GRS-ABCD-EFGH-JKLM
  email           TEXT NOT NULL,
  plan            TEXT NOT NULL CHECK (plan IN ('pass7', 'monthly', 'yearly')),
  status          TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'past_due', 'canceled', 'refunded')),
  expires_at      INTEGER NOT NULL,                 -- この時刻を過ぎたら無効
  subscription_id TEXT,                             -- 7日パスは NULL
  customer_id     TEXT,
  session_id      TEXT NOT NULL UNIQUE,             -- Checkout Session。二重発行の防止にも使う
  payment_intent  TEXT,                             -- charge.refunded から引くため
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_licenses_subscription ON licenses (subscription_id);
CREATE INDEX IF NOT EXISTS idx_licenses_payment_intent ON licenses (payment_intent);
CREATE INDEX IF NOT EXISTS idx_licenses_email ON licenses (email);

-- 処理済みの Stripe イベント。event_id の INSERT が衝突したら処理済みとして扱う。
CREATE TABLE IF NOT EXISTS stripe_events (
  event_id     TEXT PRIMARY KEY,
  type         TEXT NOT NULL,
  processed_at INTEGER NOT NULL
);
