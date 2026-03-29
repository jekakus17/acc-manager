const express = require('express');
const router = express.Router();
const db = require('../database');

// Auth middleware
function authCheck(req, res, next) {
  const password = process.env.DASHBOARD_PASSWORD || 'neuro2025';
  const auth = req.headers.authorization;
  if (!auth || auth !== `Bearer ${password}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

router.use(authCheck);

// GET /api/dashboard
router.get('/', (req, res) => {
  try {
    const totalSessions = db.prepare('SELECT COUNT(*) as c FROM sessions').get().c;
    const withEmail = db.prepare('SELECT COUNT(DISTINCT session_id) as c FROM users WHERE email IS NOT NULL').get().c;
    const buyClicks = db.prepare("SELECT COUNT(DISTINCT session_id) as c FROM events WHERE event = 'buy_click'").get().c;
    const purchased = db.prepare("SELECT COUNT(*) as c FROM purchases WHERE status = 'complete'").get().c;

    // Funnel
    const lesson1Open = db.prepare("SELECT COUNT(DISTINCT session_id) as c FROM events WHERE event = 'page_open' AND lesson = 1").get().c;
    const surveyComplete = db.prepare("SELECT COUNT(DISTINCT session_id) as c FROM events WHERE event = 'survey_complete'").get().c;
    const lesson2Open = db.prepare("SELECT COUNT(DISTINCT session_id) as c FROM events WHERE event = 'page_open' AND lesson = 2").get().c;
    const emailSubmit = db.prepare("SELECT COUNT(DISTINCT session_id) as c FROM events WHERE event = 'contact_submit'").get().c;
    const lesson3Open = db.prepare("SELECT COUNT(DISTINCT session_id) as c FROM events WHERE event = 'page_open' AND lesson = 3").get().c;

    const funnel = [
      { label: 'Урок 1 открыли', count: lesson1Open || totalSessions },
      { label: 'Анкету заполнили', count: surveyComplete },
      { label: 'Урок 2 открыли', count: lesson2Open },
      { label: 'Email оставили', count: emailSubmit },
      { label: 'Урок 3 открыли', count: lesson3Open },
      { label: 'Нажали купить', count: buyClicks },
      { label: 'Оплатили', count: purchased }
    ];

    // Video analytics per lesson
    const videoStats = {};
    for (let lesson = 1; lesson <= 3; lesson++) {
      const milestones = [];
      for (let pct = 10; pct <= 100; pct += 10) {
        const evt = pct === 100 ? 'video_complete' : `video_${pct}`;
        const count = db.prepare('SELECT COUNT(DISTINCT session_id) as c FROM events WHERE event = ? AND lesson = ?').get(evt, lesson).c;
        milestones.push({ percent: pct, count });
      }
      const playCount = db.prepare("SELECT COUNT(DISTINCT session_id) as c FROM events WHERE event = 'video_play' AND lesson = ?").get(lesson).c;
      videoStats[lesson] = { play: playCount, milestones };
    }

    // Survey analytics
    const surveyStats = {
      started: db.prepare("SELECT COUNT(DISTINCT session_id) as c FROM events WHERE event = 'survey_start'").get().c,
      completed: surveyComplete,
      abandoned: db.prepare("SELECT COUNT(*) as c FROM survey WHERE completed = 0 AND abandoned_at_question IS NOT NULL").get().c,
      abandonedByQuestion: db.prepare("SELECT abandoned_at_question as q, COUNT(*) as c FROM survey WHERE completed = 0 AND abandoned_at_question IS NOT NULL GROUP BY abandoned_at_question").all(),
      occupations: db.prepare("SELECT occupation as label, COUNT(*) as c FROM survey WHERE completed = 1 AND occupation IS NOT NULL GROUP BY occupation").all(),
      pains: db.prepare("SELECT pain as label, COUNT(*) as c FROM survey WHERE completed = 1 AND pain IS NOT NULL GROUP BY pain").all(),
      sources: db.prepare("SELECT source as label, COUNT(*) as c FROM survey WHERE completed = 1 AND source IS NOT NULL GROUP BY source").all(),
      goals: db.prepare("SELECT goal as label, COUNT(*) as c FROM survey WHERE completed = 1 AND goal IS NOT NULL GROUP BY goal").all()
    };

    // UTM sources
    const utmSources = db.prepare(`
      SELECT s.utm_source,
        COUNT(DISTINCT s.id) as sessions,
        COUNT(DISTINCT u.id) as emails,
        COUNT(DISTINCT CASE WHEN p.status = 'complete' THEN p.id END) as purchases
      FROM sessions s
      LEFT JOIN users u ON u.session_id = s.id
      LEFT JOIN purchases p ON p.session_id = s.id
      WHERE s.utm_source IS NOT NULL
      GROUP BY s.utm_source
      ORDER BY sessions DESC
    `).all();

    // Device stats
    const devices = db.prepare(`
      SELECT s.device_type,
        COUNT(DISTINCT s.id) as sessions,
        COUNT(DISTINCT u.id) as emails,
        COUNT(DISTINCT CASE WHEN p.status = 'complete' THEN p.id END) as purchases
      FROM sessions s
      LEFT JOIN users u ON u.session_id = s.id
      LEFT JOIN purchases p ON p.session_id = s.id
      GROUP BY s.device_type
    `).all();

    // Points stats
    const pointsIssued = db.prepare('SELECT COALESCE(SUM(amount),0) as c FROM points').get().c;
    const pointsUsed = db.prepare('SELECT COALESCE(SUM(amount),0) as c FROM points WHERE used = 1').get().c;
    const pointsExpired = db.prepare("SELECT COALESCE(SUM(amount),0) as c FROM points WHERE used = 0 AND expires_at <= datetime('now')").get().c;
    const pointsActive = db.prepare("SELECT COALESCE(SUM(amount),0) as c FROM points WHERE used = 0 AND expires_at > datetime('now')").get().c;
    const avgBuyerPoints = db.prepare(`
      SELECT COALESCE(AVG(points_used),0) as c FROM purchases WHERE status = 'complete'
    `).get().c;

    const pointsStats = { issued: pointsIssued, used: pointsUsed, expired: pointsExpired, active: pointsActive, avgBuyer: Math.round(avgBuyerPoints) };

    // Referral stats
    const referralStats = {
      totalReferrals: db.prepare('SELECT COUNT(*) as c FROM referrals').get().c,
      surveyCompleted: db.prepare('SELECT COUNT(*) as c FROM referrals WHERE points_awarded > 0').get().c,
      pointsAwarded: db.prepare('SELECT COALESCE(SUM(points_awarded),0) as c FROM referrals').get().c,
      top3: db.prepare(`
        SELECT ref_session_id, COUNT(*) as friends, SUM(points_awarded) as points
        FROM referrals GROUP BY ref_session_id ORDER BY friends DESC LIMIT 3
      `).all()
    };

    // Shared after purchase
    const sharedAfterPurchase = db.prepare("SELECT COUNT(DISTINCT session_id) as c FROM events WHERE event IN ('referral_link_copied','referral_telegram_click')").get().c;

    // Daily chart (last 30 days)
    const dailyStats = db.prepare(`
      SELECT date(created_at) as day,
        COUNT(*) as sessions
      FROM sessions
      WHERE created_at >= datetime('now', '-30 days')
      GROUP BY date(created_at)
      ORDER BY day
    `).all();

    const dailyEmails = db.prepare(`
      SELECT date(created_at) as day,
        COUNT(*) as emails
      FROM users
      WHERE created_at >= datetime('now', '-30 days')
      GROUP BY date(created_at)
      ORDER BY day
    `).all();

    const dailyPurchases = db.prepare(`
      SELECT date(created_at) as day,
        COUNT(*) as purchases
      FROM purchases
      WHERE status = 'complete' AND created_at >= datetime('now', '-30 days')
      GROUP BY date(created_at)
      ORDER BY day
    `).all();

    res.json({
      metrics: { totalSessions, withEmail, buyClicks, purchased },
      funnel,
      videoStats,
      surveyStats,
      utmSources,
      devices,
      pointsStats,
      referralStats,
      sharedAfterPurchase,
      purchased,
      dailyStats,
      dailyEmails,
      dailyPurchases
    });
  } catch (e) {
    console.error('GET /api/dashboard error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/dashboard/contacts
router.get('/contacts', (req, res) => {
  try {
    const { search, filter, sort, order } = req.query;
    let query = `
      SELECT u.id, u.name, u.email, u.lesson_source, u.created_at,
        s.utm_source,
        COALESCE((SELECT SUM(p.amount) FROM points p WHERE p.session_id = u.session_id AND p.expires_at > datetime('now') AND p.used = 0), 0) as points,
        (SELECT COUNT(*) FROM events e WHERE e.session_id = u.session_id AND e.event = 'buy_click') as buy_clicks,
        (SELECT COUNT(*) FROM events e WHERE e.session_id = u.session_id AND e.event = 'page_open' AND e.lesson = 3) as reached_lesson3
      FROM users u
      LEFT JOIN sessions s ON s.id = u.session_id
      WHERE u.email IS NOT NULL
    `;
    const params = [];

    if (search) {
      query += " AND (u.name LIKE ? OR u.email LIKE ?)";
      params.push(`%${search}%`, `%${search}%`);
    }

    if (filter === 'with_points') query += ' HAVING points > 0';
    else if (filter === 'lesson3') query += ' AND reached_lesson3 > 0';
    else if (filter === 'buy_click') query += ' HAVING buy_clicks > 0';

    const validSorts = ['name', 'email', 'points', 'lesson_source', 'created_at', 'utm_source'];
    const sortCol = validSorts.includes(sort) ? sort : 'created_at';
    const sortOrder = order === 'asc' ? 'ASC' : 'DESC';
    query += ` ORDER BY ${sortCol} ${sortOrder}`;

    const contacts = db.prepare(query).all(...params);
    res.json({ contacts });
  } catch (e) {
    console.error('GET /api/dashboard/contacts error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/dashboard/export/contacts
router.get('/export/contacts', (req, res) => {
  try {
    const contacts = db.prepare(`
      SELECT u.name, u.email, u.lesson_source, u.created_at, s.utm_source
      FROM users u LEFT JOIN sessions s ON s.id = u.session_id
      WHERE u.email IS NOT NULL ORDER BY u.created_at DESC
    `).all();

    let csv = 'Name,Email,Lesson,Source,Date\n';
    for (const c of contacts) {
      csv += `"${(c.name || '').replace(/"/g, '""')}","${c.email}",${c.lesson_source || ''},"${c.utm_source || ''}","${c.created_at}"\n`;
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=contacts.csv');
    res.send('\uFEFF' + csv);
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/dashboard/export/purchases
router.get('/export/purchases', (req, res) => {
  try {
    const purchases = db.prepare(`
      SELECT u.name, u.email, p.amount, p.points_used, p.discount, p.created_at
      FROM purchases p
      LEFT JOIN users u ON u.session_id = p.session_id
      WHERE p.status = 'complete'
      ORDER BY p.created_at DESC
    `).all();

    let csv = 'Name,Email,Amount,Points Used,Discount,Date\n';
    for (const p of purchases) {
      csv += `"${(p.name || '').replace(/"/g, '""')}","${p.email || ''}",${p.amount},${p.points_used},${p.discount},"${p.created_at}"\n`;
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=purchases.csv');
    res.send('\uFEFF' + csv);
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
