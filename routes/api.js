const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../database');

// POST /api/session
router.post('/session', (req, res) => {
  try {
    const { session_id, utm_source, utm_medium, utm_campaign, utm_content, utm_term, device_type, browser, os, referrer, first_lesson, ref_from } = req.body;
    if (!session_id) return res.status(400).json({ error: 'session_id required' });

    const existing = db.prepare('SELECT id FROM sessions WHERE id = ?').get(session_id);
    if (!existing) {
      db.prepare(`
        INSERT INTO sessions (id, utm_source, utm_medium, utm_campaign, utm_content, utm_term, device_type, browser, os, referrer, first_lesson, ref_from)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(session_id, utm_source || null, utm_medium || null, utm_campaign || null, utm_content || null, utm_term || null, device_type || null, browser || null, os || null, referrer || null, first_lesson || 1, ref_from || null);
    }
    res.json({ ok: true });
  } catch (e) {
    console.error('POST /api/session error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/event
router.post('/event', (req, res) => {
  try {
    const { session_id, event, lesson, value } = req.body;
    if (!session_id || !event) return res.status(400).json({ error: 'session_id and event required' });

    const user = db.prepare('SELECT id FROM users WHERE session_id = ? LIMIT 1').get(session_id);
    db.prepare(`
      INSERT INTO events (session_id, user_id, event, lesson, value)
      VALUES (?, ?, ?, ?, ?)
    `).run(session_id, user ? user.id : null, event, lesson || null, typeof value === 'object' ? JSON.stringify(value) : (value || null));

    res.json({ ok: true });
  } catch (e) {
    console.error('POST /api/event error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/survey
router.post('/survey', (req, res) => {
  try {
    const { session_id, occupation, pain, source, goal } = req.body;
    if (!session_id) return res.status(400).json({ error: 'session_id required' });

    const existing = db.prepare('SELECT id FROM survey WHERE session_id = ? AND completed = 1').get(session_id);
    if (existing) {
      const total = db.prepare("SELECT COALESCE(SUM(amount),0) as total FROM points WHERE session_id = ? AND expires_at > datetime('now') AND used = 0").get(session_id);
      return res.json({ ok: true, points: 0, total_points: total.total, already_completed: true });
    }

    db.prepare(`
      INSERT INTO survey (session_id, occupation, pain, source, goal, completed)
      VALUES (?, ?, ?, ?, ?, 1)
    `).run(session_id, occupation, pain, source, goal);

    const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();
    db.prepare(`
      INSERT INTO points (session_id, lesson, amount, reason, expires_at)
      VALUES (?, 1, 500, 'survey', ?)
    `).run(session_id, expiresAt);

    db.prepare(`
      INSERT INTO events (session_id, event, lesson, value)
      VALUES (?, 'survey_complete', 1, ?)
    `).run(session_id, JSON.stringify({ occupation, pain, source, goal }));

    // Referral reward
    const sessionRow = db.prepare('SELECT ref_from FROM sessions WHERE id = ?').get(session_id);
    if (sessionRow && sessionRow.ref_from) {
      const refExists = db.prepare('SELECT id FROM referrals WHERE friend_session_id = ? AND points_awarded > 0').get(session_id);
      if (!refExists) {
        const refExpiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();
        db.prepare(`
          INSERT INTO points (session_id, lesson, amount, reason, expires_at)
          VALUES (?, 1, 300, 'referral', ?)
        `).run(sessionRow.ref_from, refExpiresAt);

        db.prepare(`
          UPDATE referrals SET points_awarded = 300, awarded_at = datetime('now')
          WHERE ref_session_id = ? AND friend_session_id = ?
        `).run(sessionRow.ref_from, session_id);

        db.prepare(`
          INSERT INTO events (session_id, event, lesson, value)
          VALUES (?, 'referral_rewarded', 1, ?)
        `).run(sessionRow.ref_from, JSON.stringify({ ref_session: sessionRow.ref_from, friend_session: session_id, points: 300 }));
      }
    }

    const total = db.prepare("SELECT COALESCE(SUM(amount),0) as total FROM points WHERE session_id = ? AND expires_at > datetime('now') AND used = 0").get(session_id);
    res.json({ ok: true, points: 500, total_points: total.total, expires_at: expiresAt });
  } catch (e) {
    console.error('POST /api/survey error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/survey/abandon
router.post('/survey/abandon', (req, res) => {
  try {
    const { session_id, question_number } = req.body;
    if (!session_id) return res.status(400).json({ error: 'session_id required' });

    const existing = db.prepare('SELECT id FROM survey WHERE session_id = ?').get(session_id);
    if (existing) {
      db.prepare('UPDATE survey SET abandoned_at_question = ? WHERE session_id = ? AND completed = 0').run(question_number, session_id);
    } else {
      db.prepare('INSERT INTO survey (session_id, abandoned_at_question) VALUES (?, ?)').run(session_id, question_number);
    }

    db.prepare(`
      INSERT INTO events (session_id, event, lesson, value)
      VALUES (?, 'survey_abandon', 1, ?)
    `).run(session_id, JSON.stringify({ question_number }));

    res.json({ ok: true });
  } catch (e) {
    console.error('POST /api/survey/abandon error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/contact
router.post('/contact', (req, res) => {
  try {
    const { name, email, lesson, session_id } = req.body;
    if (!session_id || !email) return res.status(400).json({ error: 'session_id and email required' });

    let user = db.prepare('SELECT id FROM users WHERE session_id = ?').get(session_id);
    if (user) {
      db.prepare('UPDATE users SET name = ?, email = ?, lesson_source = ? WHERE id = ?').run(name, email, lesson, user.id);
    } else {
      const result = db.prepare('INSERT INTO users (session_id, name, email, lesson_source) VALUES (?, ?, ?, ?)').run(session_id, name, email, lesson);
      user = { id: result.lastInsertRowid };
    }

    // Reset expiry on all active points and add 1000
    const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();
    db.prepare("UPDATE points SET expires_at = ? WHERE session_id = ? AND expires_at > datetime('now') AND used = 0").run(expiresAt, session_id);

    db.prepare(`
      INSERT INTO points (session_id, user_id, lesson, amount, reason, expires_at)
      VALUES (?, ?, ?, 1000, 'contact', ?)
    `).run(session_id, user.id, lesson, expiresAt);

    db.prepare(`
      INSERT INTO events (session_id, user_id, event, lesson, value)
      VALUES (?, ?, 'contact_submit', ?, ?)
    `).run(session_id, user.id, lesson, JSON.stringify({ has_name: !!name, has_email: !!email }));

    // TODO: Unisender webhook placeholder

    const total = db.prepare("SELECT COALESCE(SUM(amount),0) as total FROM points WHERE session_id = ? AND expires_at > datetime('now') AND used = 0").get(session_id);
    res.json({ ok: true, points: 1000, total_points: total.total, expires_at: expiresAt });
  } catch (e) {
    console.error('POST /api/contact error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/points/add
router.post('/points/add', (req, res) => {
  try {
    const { session_id, lesson, amount, reason } = req.body;
    if (!session_id || !amount) return res.status(400).json({ error: 'session_id and amount required' });

    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    db.prepare(`
      INSERT INTO points (session_id, lesson, amount, reason, expires_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(session_id, lesson, amount, reason, expiresAt);

    const total = db.prepare("SELECT COALESCE(SUM(amount),0) as total FROM points WHERE session_id = ? AND expires_at > datetime('now') AND used = 0").get(session_id);
    res.json({ ok: true, total_points: total.total, expires_at: expiresAt });
  } catch (e) {
    console.error('POST /api/points/add error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/points/:session_id
router.get('/points/:session_id', (req, res) => {
  try {
    const { session_id } = req.params;
    const total = db.prepare("SELECT COALESCE(SUM(amount),0) as total FROM points WHERE session_id = ? AND expires_at > datetime('now') AND used = 0").get(session_id);
    const nearest = db.prepare("SELECT MIN(expires_at) as expires_at FROM points WHERE session_id = ? AND expires_at > datetime('now') AND used = 0").get(session_id);
    const breakdown = db.prepare("SELECT amount, reason, expires_at, lesson FROM points WHERE session_id = ? AND expires_at > datetime('now') AND used = 0 ORDER BY created_at").all(session_id);

    let secondsLeft = 0;
    let expiresAt = null;
    if (nearest && nearest.expires_at) {
      expiresAt = nearest.expires_at;
      secondsLeft = Math.max(0, Math.floor((new Date(nearest.expires_at).getTime() - Date.now()) / 1000));
    }

    res.json({ total: total.total, expires_at: expiresAt, seconds_left: secondsLeft, breakdown });
  } catch (e) {
    console.error('GET /api/points error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/purchase/init
router.post('/purchase/init', (req, res) => {
  try {
    const { session_id } = req.body;
    if (!session_id) return res.status(400).json({ error: 'session_id required' });

    const total = db.prepare("SELECT COALESCE(SUM(amount),0) as total FROM points WHERE session_id = ? AND expires_at > datetime('now') AND used = 0").get(session_id);
    const fullPrice = 15000;
    const discount = Math.min(total.total, fullPrice);
    const finalPrice = fullPrice - discount;

    const result = db.prepare(`
      INSERT INTO purchases (session_id, amount, points_used, discount, status)
      VALUES (?, ?, ?, ?, 'pending')
    `).run(session_id, finalPrice, discount, discount);

    const purchaseId = result.lastInsertRowid;

    db.prepare(`
      INSERT INTO events (session_id, event, lesson, value)
      VALUES (?, 'purchase_init', 3, ?)
    `).run(session_id, JSON.stringify({ purchase_id: purchaseId, amount: finalPrice, discount }));

    // Robokassa URL generation
    const login = process.env.ROBOKASSA_LOGIN || '';
    const password1 = process.env.ROBOKASSA_PASSWORD1 || '';
    const isTest = process.env.ROBOKASSA_TEST === 'true';
    const signature = crypto.createHash('md5').update(`${login}:${finalPrice}:${purchaseId}:${password1}`).digest('hex');
    const baseUrl = isTest ? 'https://auth.robokassa.ru/Merchant/Index.aspx' : 'https://auth.robokassa.ru/Merchant/Index.aspx';
    const robokassaUrl = `${baseUrl}?MrchLogin=${login}&OutSum=${finalPrice}&InvId=${purchaseId}&SignatureValue=${signature}${isTest ? '&IsTest=1' : ''}`;

    res.json({ purchase_id: purchaseId, amount: finalPrice, discount, final_price: finalPrice, robokassa_url: robokassaUrl });
  } catch (e) {
    console.error('POST /api/purchase/init error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/purchase/webhook (Robokassa Result URL)
router.post('/purchase/webhook', (req, res) => {
  try {
    const { OutSum, InvId, SignatureValue } = req.body;
    const password2 = process.env.ROBOKASSA_PASSWORD2 || '';
    const expectedSig = crypto.createHash('md5').update(`${OutSum}:${InvId}:${password2}`).digest('hex');

    if (SignatureValue.toLowerCase() !== expectedSig.toLowerCase()) {
      return res.status(403).send('Invalid signature');
    }

    const purchase = db.prepare('SELECT * FROM purchases WHERE id = ?').get(InvId);
    if (!purchase) return res.status(404).send('Purchase not found');

    db.prepare("UPDATE purchases SET status = 'complete', robokassa_id = ? WHERE id = ?").run(InvId, InvId);

    // Mark points as used
    if (purchase.points_used > 0 && purchase.session_id) {
      const activePoints = db.prepare("SELECT id, amount FROM points WHERE session_id = ? AND expires_at > datetime('now') AND used = 0 ORDER BY created_at").all(purchase.session_id);
      let remaining = purchase.points_used;
      for (const p of activePoints) {
        if (remaining <= 0) break;
        db.prepare("UPDATE points SET used = 1, used_at = datetime('now') WHERE id = ?").run(p.id);
        remaining -= p.amount;
      }
    }

    db.prepare(`
      INSERT INTO events (session_id, event, lesson, value)
      VALUES (?, 'purchase_complete', 3, ?)
    `).run(purchase.session_id, JSON.stringify({ purchase_id: InvId, amount: OutSum, points_used: purchase.points_used }));

    res.send(`OK${InvId}`);
  } catch (e) {
    console.error('POST /api/purchase/webhook error:', e);
    res.status(500).send('Error');
  }
});

// POST /api/referral/register
router.post('/referral/register', (req, res) => {
  try {
    const { ref_session_id, friend_session_id } = req.body;
    if (!ref_session_id || !friend_session_id) return res.status(400).json({ error: 'Both session IDs required' });

    const existing = db.prepare('SELECT id FROM referrals WHERE friend_session_id = ?').get(friend_session_id);
    if (!existing) {
      db.prepare('INSERT INTO referrals (ref_session_id, friend_session_id) VALUES (?, ?)').run(ref_session_id, friend_session_id);
    }
    res.json({ ok: true });
  } catch (e) {
    console.error('POST /api/referral/register error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
