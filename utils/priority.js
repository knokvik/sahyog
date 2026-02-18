// Basic SOS priority scoring, adapted from the spec

function calculatePriority(sosData) {
  let score = 0;

  if (sosData.type === 'medical') score += 50;
  if (sosData.type === 'fire') score += 40;

  const peopleCount = sosData.peopleCount || sosData.people_count || 1;
  score += peopleCount * 10;

  if (sosData.hasVulnerable || sosData.has_vulnerable) score += 20;

  if (sosData.createdAt || sosData.created_at) {
    const createdAt = new Date(sosData.createdAt || sosData.created_at).getTime();
    const hoursOld = (Date.now() - createdAt) / 3600000;
    score -= hoursOld * 5;
  }

  if (Number.isFinite(score)) {
    if (score < 0) score = 0;
    if (score > 100) score = 100;
  } else {
    score = 0;
  }

  return Math.round(score);
}

module.exports = {
  calculatePriority,
};

