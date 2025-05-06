import fs from 'fs';
import log4js from 'log4js';

const settings = JSON.parse(fs.readFileSync('settings.json', 'utf8'));
var logger = log4js.getLogger('globals');
logger.level = settings.loggerLevel;

var authService;
var authServiceLocation = process.env.AUTH_SERVICE;

// The following commented old code allowed the developer to choose between a custom local authorization module or
// HTTP authorization. But it uses dynamic require-style modules, which is not supported in the current modified version
// of ACME Air. The new code below only supports HTTP-based authorization.
// if (authServiceLocation) {
//     logger.info("Use authservice:" + authServiceLocation);
//     var authModule;
//     if (authServiceLocation.indexOf(":") > 0) // This is to use micro services
//         authModule = "acmeairhttp";
//     else
//         authModule = authServiceLocation;

//     authService = new require('./' + authModule + '/index.js')(settings);
//     if (authService && "true" == process.env.enableHystrix) // wrap into command pattern
//     {
//         logger.info("Enabled Hystrix");
//         authService = new require('./acmeaircmd/index.js')(authService, settings);
//     }
// }


if (authServiceLocation) {
    logger.info("Use authservice:" + authServiceLocation);
    authService = new createAuthService(settings);
    if (authService && "true" == process.env.enableHystrix) // wrap into command pattern
    {
        logger.info("Enabled Hystrix");
        authService = new createHystrixService(authService, settings);
    }
}

var dbtype = process.env.dbtype || "mongo";

// Calculate the backend datastore type if run inside BLuemix or cloud foundry
if (process.env.VCAP_SERVICES) {
    var env = JSON.parse(process.env.VCAP_SERVICES);
    logger.info("env: %j", env);
    var serviceKey = Object.keys(env)[0];
    if (serviceKey && serviceKey.indexOf('cloudant') > -1)
        dbtype = "cloudant";
    else if (serviceKey && serviceKey.indexOf('redis') > -1)
        dbtype = "redis";
}
logger.info("db type==" + dbtype);


export {
    settings,
    authService,
    dbtype
}