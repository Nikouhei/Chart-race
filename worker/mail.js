// Resend でライセンスキーを送る。APIキーは env.RESEND_API_KEY、送信元は env.RESEND_FROM。
// 問い合わせ先。本文に書き、返信先（Reply-To）にも使う（送信元は noreply なので、返信がここへ届くようにする）
const SUPPORT_EMAIL = 'support@graphrace-studio.com';
const PLAN_NAMES = {
  ja: { pass7: '7日パス', monthly: '月額プラン', yearly: '年額プラン' },
  en: { pass7: '7-Day Pass', monthly: 'Monthly plan', yearly: 'Yearly plan' },
};

function formatDate(sec, lang) {
  return new Intl.DateTimeFormat(lang === 'en' ? 'en-US' : 'ja-JP', {
    year: 'numeric', month: 'long', day: 'numeric', timeZone: lang === 'en' ? 'UTC' : 'Asia/Tokyo',
  }).format(new Date(sec * 1000));
}

export function buildLicenseEmail({ key, plan, expiresAt, lang }) {
  const l = lang === 'en' ? 'en' : 'ja';
  const planName = PLAN_NAMES[l][plan] || plan;
  const date = formatDate(expiresAt, l);
  const isPass = plan === 'pass7';
  if (l === 'en') {
    const lines = [
      'Thank you for your purchase of GraphRace Studio.',
      '',
      `License key: ${key}`,
      `Plan: ${planName}`,
      isPass ? `Valid until: ${date} (UTC)` : `Current period ends: ${date} (UTC)`,
      '',
      'How to use: when you export in a tool, open "I have a license key" in the dialog and paste the key above.',
      '',
      isPass ? '' : 'Cancel or update your payment method through Link (link.com).',
      'Your card statement will show "LINK.COM*". Receipts are sent by Link.',
      '',
      `Questions? Reply to this email or write to ${SUPPORT_EMAIL}.`,
    ].filter((x, i, a) => !(x === '' && a[i - 1] === ''));
    return { subject: '[GraphRace Studio] Your license key', text: lines.join('\n') };
  }
  const lines = [
    'GraphRace Studio をご購入いただきありがとうございます。',
    '',
    `ライセンスキー: ${key}`,
    `プラン: ${planName}`,
    isPass ? `有効期限: ${date} まで` : `現在の期間の終わり: ${date}`,
    '',
    '使い方: ツールで書き出すときに表示される案内の「ライセンスキーをお持ちの方」を開き、上のキーを貼り付けてください。',
    '',
    isPass ? '' : '解約・お支払い方法の変更は Link（link.com）から行えます。',
    'カードの明細には「LINK.COM*」と表示されます。領収書は Link から届きます。',
    '',
    `ご不明な点は、このメールへの返信か ${SUPPORT_EMAIL} までご連絡ください。`,
  ].filter((x, i, a) => !(x === '' && a[i - 1] === ''));
  return { subject: '【GraphRace Studio】ライセンスキーのお届け', text: lines.join('\n') };
}

// 送れたら true。設定が無い（ローカル開発など）ときは警告だけ出して false。Resend が失敗したら例外。
export async function sendLicenseEmail(env, { to, key, plan, expiresAt, lang }) {
  if (!env.RESEND_API_KEY || !env.RESEND_FROM) {
    console.warn('[mail] RESEND_API_KEY / RESEND_FROM が未設定のため送信をスキップ');
    return false;
  }
  const { subject, text } = buildLicenseEmail({ key, plan, expiresAt, lang });
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: env.RESEND_FROM, to: [to], reply_to: SUPPORT_EMAIL, subject, text }),
  });
  if (!res.ok) {
    // 本文（宛先・キー）はログに出さず、状態だけ記録する
    console.error('[mail] resend failed', res.status);
    throw new Error(`resend_${res.status}`);
  }
  return true;
}
