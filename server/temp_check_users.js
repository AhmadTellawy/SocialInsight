const main = async () = const prisma = new (require('@prisma/client').PrismaClient)(); const users = await prisma.user.findMany(); console.log(JSON.stringify(users, null, 2)); }; main();  
