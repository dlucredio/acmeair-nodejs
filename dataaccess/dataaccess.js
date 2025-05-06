import cassandraDataAccess from '../dataaccess/cassandra/index.js';
import cloudantDataAccess from '../dataaccess/cloudant/index.js';
import mongoDataAccess from '../dataaccess/mongo/index.js';
import log4js from 'log4js';
import { settings, dbtype } from '../globals.js';

const dataAccesses = {
    cassandra: cassandraDataAccess,
    cloudant: cloudantDataAccess,
    mongo: mongoDataAccess
};

var logger = log4js.getLogger('dataaccess');
logger.level = settings.loggerLevel;

let instance = null;
let initialized = false;

export default async function getInstance() {
    if(instance && initialized) {
        return instance;
    }
    if(!instance) {
        logger.info("Using db:" + dbtype);
        instance = dataAccesses[dbtype];
    }
    if(!initialized) {
        logger.info("Initializing database connections...");
        const maxRetries = 5;
        let attempts = 0;
    
        while (attempts < maxRetries) {
            try {
                await instance.initializeDatabaseConnections();
                logger.info("Initialized database connections");
                initialized = true;
                return instance;
            } catch (error) {
                attempts++;
                logger.info(`Error connecting to database (Attempt ${attempts}/${maxRetries}) - ${error.message}`);
    
                if (attempts < maxRetries) {
                    logger.info('Retrying in 10 seconds...');
                    await new Promise(resolve => setTimeout(resolve, 10000)); // Espera 10 segundos antes de tentar novamente
                } else {
                    logger.error('Max retries reached. Could not connect to database.');
                    throw error;
                }
            }
        }
    }
}