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
// Dataaccess must implement 
//	 	dbNames:  { customerName:, flightName:, flightSegmentName:, bookingName:, customerServiceName:, airportCodeMappingName:}
// 		initializeDatabaseConnections(function(error))
// 		insertOne(collname, doc, function(error, doc))
// 		findOne(collname, _id value, function(error, doc))
//		update(collname, doc, function(error, doc))
//		remove(collname, condition as json of field and value, function(error))
// 		findBy(collname, condition as json of field and value,function(err, docs))
//		count(collname, condition as json of field and value, function(error, count))

import { MongoClient } from 'mongodb';
import log4js from 'log4js';

export default function (settings) {
    var module = {};

    var logger = log4js.getLogger('dataaccess/mongo');
    logger.level = settings.loggerLevel;

    module.dbNames = {
        customerName: "customer",
        flightName: "flight",
        flightSegmentName: "flightSegment",
        bookingName: "booking",
        customerSessionName: "customerSession",
        airportCodeMappingName: "airportCodeMapping"
    }

    var dbclient = null;

    module.initializeDatabaseConnections = async function () {
        var mongo = null;
        var mongoURI = null;
        if (process.env.VCAP_SERVICES) {
            var env = JSON.parse(process.env.VCAP_SERVICES);
            logger.info("env: %j", env);
            var serviceKey = Object.keys(env)[0];
            if (serviceKey) {
                mongo = env[serviceKey][0]['credentials'];
                logger.info("mongo: %j", mongo);
            }
        }

        // The section is for docker integration using link
        if (mongo == null && process.env.MONGO_PORT != null) {
            logger.info(process.env.MONGO_PORT);
            logger.info(process.env.MONGO_PORT_27017_TCP_ADDR);
            logger.info(process.env.MONGO_PORT_27017_TCP_PORT);
            mongo = {
                "hostname": process.env.MONGO_PORT_27017_TCP_ADDR,
                "port": process.env.MONGO_PORT_27017_TCP_PORT,
                "username": "",
                "password": "",
                "name": "",
                "db": "acmeair"
            }
        }
        // Default to read from settings file
        if (mongo == null) {
            mongo = {
                "hostname": settings.mongoHost,
                "port": settings.mongoPort,
                "username": "",
                "password": "",
                "name": "",
                "db": "acmeair"
            }
        }

        var generate_mongo_url = function (obj) {
            if (process.env.MONGO_URL) {
                logger.info("mongo: %j", process.env.MONGO_URL);
                return process.env.MONGO_URL;
            }
            if (obj['uri'] != null) {
                return obj.uri;
            }
            if (obj['url'] != null) {
                return obj.url;
            }
            obj.hostname = (obj.hostname || 'localhost');
            obj.port = (obj.port || 27017);
            obj.db = (obj.db || 'acmeair');

            if (obj.username && obj.password) {
                return "mongodb://" + obj.username + ":" + obj.password + "@" + obj.hostname + ":" + obj.port + "/" + obj.db;
            }
            else {
                return "mongodb://" + obj.hostname + ":" + obj.port + "/" + obj.db;
            }
        }

        var mongourl = generate_mongo_url(mongo);

        logger.debug(`Mongo URL: ${mongourl}`);

        var c_opt = {
            maxPoolSize: settings.mongoConnectionPoolSize,
            serverSelectionTimeoutMS: 5000
        };

        const client = new MongoClient(mongourl, c_opt);

        logger.debug(`Trying to connect to MongoDB`);

        await client.connect();
        logger.debug(`Connected to MongoDB. Obtaining connection to database ${mongo.db}`);
        dbclient = client.db(mongo.db);

        // logger.info("Adding erasureIndexes...");
        // // Add ensureIndex here
        // dbclient.ensureIndex(module.dbNames.bookingName, { customerId: 1 }
        //     , { background: true }, function (err, indexName) {
        //         logger.info("ensureIndex:" + err + ":" + indexName);
        //     });
        // dbclient.ensureIndex(module.dbNames.flightName, { flightSegmentId: 1, scheduledDepartureTime: 2 }
        //     , { background: true }, function (err, indexName) {
        //         logger.info("ensureIndex:" + err + ":" + indexName);
        //     });
        // dbclient.ensureIndex(module.dbNames.flightSegmentName, { originPort: 1, destPort: 2 }
        //     , { background: true }, function (err, indexName) {
        //         logger.info("ensureIndex:" + err + ":" + indexName);
        //     });
        logger.debug("Finished connecting with success!");

    }

    module.insertOne = async function (collectionname, doc) {
        logger.info("Inserting: " + JSON.stringify(doc));
        const result = await dbclient.collection(collectionname).insertOne(doc);
        logger.info("Inserted document:", result);
        return result;
    };

    module.findOne = async function (collectionname, key) {
        const doc = await dbclient.collection(collectionname).findOne({ _id: key });
        if(doc) {
            return doc;
        }
        logger.debug("Not found:" + key);
        return null;
    };


    module.update = async function (collectionname, doc) {
        const result = await dbclient.collection(collectionname).updateOne(
            { _id: doc._id },
            { $set: doc }
        );

        logger.debug("Number of documents matched: " + result.matchedCount);
        logger.debug("Number of documents updated: " + result.modifiedCount);
        return doc;
    };


    module.remove = async function (collectionname, condition) {
        await dbclient.collection(collectionname).deleteOne({ _id: condition._id });
    };


    module.findBy = async function (collectionname, condition) {
        const docs = await dbclient.collection(collectionname).find(condition).toArray();
        return docs;
    };

    module.count = async function (collectionname, condition) {
        const count = await dbclient.collection(collectionname).countDocuments(condition);
        return count;
    };


    return module;

}

