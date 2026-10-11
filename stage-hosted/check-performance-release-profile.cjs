'use strict';
const assert=require('node:assert/strict');
const profile=require('./performance-release-profile.json');
for(const [name,value] of Object.entries(profile.backendEnvironment))assert.equal(process.env[name],value,'Release configuration mismatch: '+name);
console.log(JSON.stringify({profile:profile.profile,verifiedEnvironmentNames:Object.keys(profile.backendEnvironment),instanceCountMustBeVerified:profile.instances}));
