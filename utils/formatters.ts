export const formatCount = (num: number): string | number => {
  if (num === undefined || num === null) return 0;
  return num >= 1000 ? (num / 1000).toFixed(1) + 'K' : num;
};

export const getPercentage = (votes: number, totalVotes: number): number => {
  if (!votes || totalVotes === 0) return 0;
  return Math.round((votes / totalVotes) * 100);
};
