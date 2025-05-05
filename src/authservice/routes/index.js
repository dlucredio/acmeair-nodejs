/*******************************************************************************
* Copyright (c) 2015 IBM Corp.
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
*    http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
*******************************************************************************/

import { v4 as uuidv4 } from 'uuid';
import log4js from 'log4js';
import createCassandraDataAccess from '../../dataaccess/cassandra/index.js';
import createCloudantDataAccess from '../../dataaccess/cloudant/index.js';
import createMongoDataAccess from '../../dataaccess/mongo/index.js';

const dataAccessFactories = {
    cassandra: createCassandraDataAccess,
    cloudant: createCloudantDataAccess,
    mongo: createMongoDataAccess
};


export default async function (dbtype, settings) {
    var module = {};
    var logger = log4js.getLogger('authservice/routes');
    logger.level = settings.loggerLevel;


    logger.info("Using db:" + dbtype);
    const dataaccess = new dataAccessFactories[dbtype](settings);

    module.dbNames = dataaccess.dbNames

    module.initializeDatabaseConnections = () => dataaccess.initializeDatabaseConnections();

    module.createSessionInDB = async function (customerId) {
        logger.debug("create session in DB:" + customerId);

        var now = new Date();
        var later = new Date(now.getTime() + 1000 * 60 * 60 * 24);

        var document = { "_id": uuidv4(), "customerid": customerId, "lastAccessedTime": now, "timeoutTime": later };

        await dataaccess.insertOne(module.dbNames.customerSessionName, document);

        return document;
    }

    module.validateSessionInDB = async function (sessionId) {
        logger.debug("validate session in DB:" + sessionId);
        var now = new Date();

        const session = await dataaccess.findOne(module.dbNames.customerSessionName, sessionId);
        if (now > session.timeoutTime) {
            await dataaccess.remove(module.dbNames.customerSessionName, sessionId);
            return null;
        }
        else {
            return session;
        }
    }

    module.invalidateSessionInDB = async function (sessionid) {
        logger.debug("invalidate session in DB:" + sessionid);
        await dataaccess.remove(module.dbNames.customerSessionName, sessionid);
    }

    return module;
}