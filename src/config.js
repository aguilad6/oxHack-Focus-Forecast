// All the numbers and lists we might want to tweak, in one place.

module.exports = {
  // How often the app collects data (milliseconds).
  tickMs: 1000,

  // Self-report pop-up ("How focused were you? 1-5").
  selfReport: {
    awayMinutes: 5,       // no keyboard/mouse for this long = user has left (ask when they're back)
    popupTimeoutSec: 60,  // pop-up closes by itself if ignored; nothing is saved
  },

  // Which apps/sites count as work or distraction. Matched (lowercase) against the app name and
  // the window title, e.g. "LinkedIn - Google Chrome". Distraction is checked first, so a YouTube tab
  // in Chrome counts as distraction. Anything that matches neither list is 'neutral'.
  categories: {
    distraction: [
      'youtube', 'linkedin', 'facebook', 'instagram', 'twitter', 'reddit', 'tiktok',
      'netflix', 'twitch', 'whatsapp', 'discord', 'spotify', 'steam',
    ],
    onTask: [
      'visual studio', 'code', 'word', 'excel', 'powerpoint', 'notion', 'overleaf',
      'terminal', 'powershell', 'acrobat', 'pdf', 'google docs', 'stack overflow', 'github',
    ],
  },
};
