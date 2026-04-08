import prisma from './src/prisma';

async function test() {
  const total = await prisma.post.count();
  console.log('Total posts:', total);

  const matched = await prisma.post.count({
    where: {
       OR: [
         { targetAudience: { not: 'Followers' } }
       ]
    }
  });
  console.log('Matched { not: "Followers" }:', matched);

  const matchedWithNull = await prisma.post.count({
    where: {
       OR: [
         { targetAudience: { not: 'Followers' } },
         { targetAudience: null }
       ]
    }
  });
  console.log('Matched with null:', matchedWithNull);
}

test().catch(console.error).finally(() => prisma.$disconnect());
