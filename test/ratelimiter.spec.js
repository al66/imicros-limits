"use strict";

const { afterEach } = require("jest-circus");
const { ServiceBroker } = require("moleculer");
const { Ratelimiter } = require("../index");

const timestamp = Date.now();
const ownerId = `g1-${timestamp}`;
const bucketA = `b1-${timestamp}`;
const bucketB = `b2-${timestamp}`;
const user = { 
    id: `1-${timestamp}` , 
    email: `1-${timestamp}@host.com` 
};
let limits = {};
limits[bucketA] = {
    capacity: 100,
    seconds: 60,
    refill: 10,
    persistent: false
};
limits[bucketB] = {
    capacity: 100,
    seconds: 60,
    refill: 10,
    persistent: true
};

describe("Test ratelimiter service", () => {

    let broker, service;
    beforeAll(() => {
    });
    
    afterAll(async () => {
    });
    
    describe("Test create service", () => {

        it("it should start the broker", async () => {
            broker = new ServiceBroker({
                logger: console,
                logLevel: "info" //"debug"
            });
            service = await broker.createService(Ratelimiter, Object.assign({ 
                name: "ratelimiter", 
                settings: { 
                    redis: {
                        port: process.env.REDIS_PORT || 6379,
                        host: process.env.REDIS_HOST || "127.0.0.1",
                        password: process.env.REDIS_AUTH || "",
                        db: process.env.REDIS_DB || 0,
                    },
                    limits
                }
            }));
            await broker.start();
            expect(service).toBeDefined();
        });

    });

    describe("Test ratelimiter service", () => {

        let opts;
        const bucketName = bucketA;
        
        beforeEach(() => {
            opts = { meta: { user, ownerId } };
        });

        it("it should consume a token", async () => {
            let params = {
                service: bucketName
            };
            return broker.call("ratelimiter.take", params, opts).then(res => {
                expect(res).toBeDefined();
                expect(res).toEqual(true);
            });
        });

        it("it should return 99 token in bucket info", async () => {
            let params = {
                service: bucketName
            };
            return broker.call("ratelimiter.info", params, opts).then(res => {
                expect(res).toBeDefined();
                expect(res.token).toEqual(99);
            });
        });

        it("it should consume 99 token", async () => {
            let params = {
                service: bucketName,
                count: 99
            };
            return broker.call("ratelimiter.take", params, opts).then(res => {
                expect(res).toBeDefined();
                expect(res).toEqual(true);
            });
        });

        it("it should return empty token in bucket info", async () => {
            let params = {
                service: bucketName
            };
            return broker.call("ratelimiter.info", params, opts).then(res => {
                expect(res).toBeDefined();
                expect(res.token).toEqual(0);
            });
        });

        it("it should fail to consume an additional token", async () => {
            let params = {
                service: bucketName
            };
            return broker.call("ratelimiter.take", params, opts).then(res => {
                expect(res).toBeDefined();
                expect(res).toEqual(false);
            });
        });

    });

    describe("Test ratelimiter service - refill", () => {

        let opts;
        const bucketName =  bucketB;
        
        beforeEach(() => {
            opts = { meta: { user, ownerId } };
        });

        afterEach(() => {
        });

        it("it should consume 100 token", async () => {
            let params = {
                service: bucketName,
                count: 100
            };
            return broker.call("ratelimiter.take", params, opts).then(res => {
                expect(res).toBeDefined();
                expect(res).toEqual(true);
            });
        });
       
        it("it should return 0 token in bucket info", async () => {
            let params = {
                service: bucketName
            };
            return broker.call("ratelimiter.info", params, opts).then(res => {
                expect(res).toBeDefined();
                expect(res.token).toEqual(0);
            });
        });

        it("it should consume again 20 token from refill", async () => {
            jest.useFakeTimers();
            jest.setSystemTime(jest.getRealSystemTime().valueOf() + 120 * 1000);
            let params = {
                service: bucketName,
                count: 20
            };
            return broker.call("ratelimiter.take", params, opts).then(res => {
                jest.runAllTimers();
                jest.useRealTimers();
                expect(res).toBeDefined();
                expect(res).toEqual(true);
            });
        });

        it("it should return 0 token in bucket info", async () => {
            let params = {
                service: bucketName
            };
            return broker.call("ratelimiter.info", params, opts).then(res => {
                expect(res).toBeDefined();
                expect(res.token).toEqual(0);
            });
        });
        
        it("it should consume again 20 token from refill to capacity", async () => {
            jest.useFakeTimers();
            jest.setSystemTime(jest.getRealSystemTime().valueOf() + 60000 * 1000);
            let params = {
                service: bucketName,
                count: 20
            };
            return broker.call("ratelimiter.take", params, opts).then(res => {
                jest.runAllTimers();
                jest.useRealTimers();
                expect(res).toBeDefined();
                expect(res).toEqual(true);
            });
        });

        it("it should return 80 token in bucket info", async () => {
            let params = {
                service: bucketName
            };
            return broker.call("ratelimiter.info", params, opts).then(res => {
                expect(res).toBeDefined();
                expect(res.token).toEqual(80);
            });
        });
    });

    describe("Test stop broker", () => {

        it("should stop the broker", async () => {
            expect.assertions(1);
            await broker.stop();
            expect(broker).toBeDefined();
        });
    });    
    
});