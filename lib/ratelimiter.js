/**
 * @license MIT, imicros.de (c) 2022 Andreas Leinen
 */
 "use strict";

 const Redis = require("ioredis");
 
 module.exports = {
    name: "ratelimiter",
    
    /**
     * Service settings
     */
    settings: {
    },

    /**
     * Service metadata
     */
    metadata: {},

    /**
     * Actions
     */
    actions: {

        /**
         * take - consume tokens from bucket
         * 
         * @actions
         * @param {String} service - bucket name
         * @param {Number} count - optional
         * 
         * @returns {Boolean} true|false
         */
        take: {
            params: {
                service: { type: "string" },
                count: { type: "number", default: 1, positive: true, integer: true, optional: true  }
            },			
            async handler(ctx) {
                let owner = ctx?.meta?.ownerId;
                if (!owner) return false;

                let result = await this.take({ owner, service: ctx.params.service, count: ctx.params.count });
                return result;
            }
        },

        /**
         * info - get bucket
         * 
         * @actions
         * @param {String} service - bucket name
         * 
         * @returns {Object} bucket
         */
         info: {
            params: {
                service: { type: "string" }
            },			
            async handler(ctx) {
                let owner = ctx?.meta?.ownerId;
                if (!owner) return {};

                let result = await this.getBucket({ owner, service: ctx.params.service });
                return result;
            }
        }

    },

    /**
     * Events
     */
    events: {},

    /**
     * Methods
     */
    methods: {
        
        async getBucket({ owner, service }) {
            let bucket = await this.getBucketFromCache({ owner, service });
            const persistent = this.settings?.limits?.[service]?.persistent || false;

            // get bucket persistent
            if (!bucket && persistent) {
                bucket = await this.getBucketPersistent({ owner, service });
            }

            // new bucket
            if (!bucket) {
                bucket = await this.newBucket({ owner, service });
                await this.addBucketToCache({ bucket });
            }

            return bucket;
        },

        buildKey({ owner, service }) {
            return `${owner}.${service}`;
        },

        async getBucketFromCache({ owner, service }) {
            const key = this.buildKey({ owner, service });

            let hash = await this.client.hgetall(key);
            if (hash && hash.owner) {
                hash.capacity = parseInt(hash.capacity);
                hash.seconds = parseInt(hash.seconds);
                hash.refill = parseInt(hash.refill);
                hash.token = parseInt(hash.token);
                return hash;
            } else {
                return null;
            }
        },

        async addBucketToCache({ bucket }) {
            const key = this.buildKey({ owner: bucket.owner , service: bucket.service });

            const result = await this.client.hset(key, "owner", bucket.owner, 
                                    "service", bucket.service, 
                                    "capacity", bucket.capacity,
                                    "seconds", bucket.seconds,
                                    "refill", bucket.refill,
                                    "lastfill", bucket.lastfill,
                                    "persistent", bucket.persistent,
                                    "token", bucket.token );
            return bucket;
        },

        async getBucketPersistent({ owner, service }) {
            const key = this.buildKey({ owner, service });

            // TODO: Read bucket persistent
            if (!this.buckets) this.buckets = [];
            if (!this.buckets[key]) this.buckets[key] = this.newBucket({ owner, service });
            const bucket =  await this.buckets[key];

            // Add to cache
            await this.addBucketToCache({ bucket });
            return bucket;
        },

        async storeBucket({ bucket }) {
            const key = this.buildKey({ owner: bucket.owner , service: bucket.service });

            // TODO: save bucket persistent on DB
            if (!this.buckets) this.buckets = [];
            this.buckets[key] = bucket;
        },

        async consume({ bucket, count}) {
            const key = this.buildKey({ owner: bucket.owner , service: bucket.service });

            const result = await this.client.hincrby(key, "token", (count * -1));
        },

        async add({ bucket, count }) {
            const key = this.buildKey({ owner: bucket.owner , service: bucket.service });
            const now = Math.floor(Date.now() / 1000);

            await this.client.hset(key, "lastfill", now);
            await this.client.hincrby(key, "token", count);
        },

        async refill ({ bucket = {} }) {
            const now = Math.floor(Date.now() / 1000);
            const rate = Math.floor(((now - bucket.lastfill) / bucket.seconds) * bucket.refill );
            if (rate > 0) {
                const count = Math.min(bucket.capacity, rate) - bucket.token;
                if (count !== 0) this.logger.debug("refill", { bucket, token: bucket.token, count, rate });
                bucket.token += count;
                if (count > 0) await this.add({ bucket, count });
            }
        },

        async take ({ owner = null, service = null, count = 1 } = {}) {
            // this.logger.debug("take", owner, service);
            let bucket = await this.getBucket({owner, service});
            await this.refill({bucket});

            if (bucket.token > 0) {
                await this.consume({ bucket, count });
                if (bucket.persistent) await this.storeBucket({ bucket });
                return true;
            }
            return false;
        },
        
        async newBucket ({ owner = null, service = null } = {}) {
            let defaults = this.settings.limits[service] || {};
            this.logger.debug("newBucket", { defaults });
            const bucket = {
                owner,
                service,
                capacity: defaults.capacity || 1,
                seconds: defaults.seconds || 3600,
                refill: defaults.refill || 1,
                lastfill: Math.floor(Date.now() / 1000),
                persistent: defaults.persistent || false,
                token: 100
            };
            return bucket;
        },
        
        connect () {
            return new Promise((resolve, reject) => {
                /* istanbul ignore else */
                let redisOptions = this.settings.redis || {};   // w/o settings the client uses defaults: 127.0.0.1:6379
                this.client = new Redis(redisOptions);

                this.client.on("connect", (() => {
                    this.connected = true;
                    this.logger.info("Connected to Redis");
                    resolve();
                }).bind(this));

                this.client.on("close", (() => {
                    this.connected = false;
                    this.logger.info("Disconnected from Redis");
                }).bind(this));

                this.client.on("error", ((err) => {
                    this.logger.error("Redis redis error", err.message);
                    this.logger.debug(err);
                    /* istanbul ignore else */
                    if (!this.connected) reject(err);
                }).bind(this));
            });
        },        
        
        async disconnect () {
            return new Promise((resolve) => {
                /* istanbul ignore else */
                if (this.client && this.connected) {
                    this.client.on("close", () => {
                        resolve();
                    });
                    this.client.disconnect();
                } else {
                    resolve();
                }
            });
        }
        
    },

    /**
     * Service created lifecycle event handler
     */
    created() {
        
    },

    /**
     * Service started lifecycle event handler
     */
    async started() {
        
        // connect to redis db
        await this.connect();
        
    },

    /**
     * Service stopped lifecycle event handler
     */
    async stopped() {
        
        // disconnect from redis db
        await this.disconnect();
        
    }
    
};
