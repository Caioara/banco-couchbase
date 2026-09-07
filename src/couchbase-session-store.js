const couchbase = require("couchbase");
const session = require("express-session");

class CouchbaseSessionStore extends session.Store {
  constructor({ getCollection, ttlSeconds = 86400 }) {
    super();
    this.getCollection = getCollection;
    this.ttlSeconds = ttlSeconds;
  }

  async _collection() {
    return this.getCollection();
  }

  async get(sid, callback) {
    try {
      const collection = await this._collection();
      const result = await collection.get(sid);
      callback(null, result.content);
    } catch (error) {
      if (error instanceof couchbase.DocumentNotFoundError) {
        return callback(null, null);
      }
      return callback(error);
    }
  }

  async set(sid, sessionData, callback) {
    try {
      const collection = await this._collection();
      const ttl = this._resolveTtl(sessionData);
      await collection.upsert(sid, sessionData, ttl ? { expiry: ttl } : undefined);
      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  async destroy(sid, callback) {
    try {
      const collection = await this._collection();
      await collection.remove(sid);
      callback(null);
    } catch (error) {
      if (error instanceof couchbase.DocumentNotFoundError) {
        return callback(null);
      }
      return callback(error);
    }
  }

  async touch(sid, sessionData, callback) {
    try {
      const ttl = this._resolveTtl(sessionData);
      if (!ttl) {
        return callback(null);
      }

      const collection = await this._collection();
      await collection.touch(sid, ttl);
      return callback(null);
    } catch (error) {
      if (error instanceof couchbase.DocumentNotFoundError) {
        return callback(null);
      }
      return callback(error);
    }
  }

  _resolveTtl(sessionData) {
    const expires = sessionData?.cookie?.expires
      ? new Date(sessionData.cookie.expires).getTime()
      : null;
    if (!expires) {
      return this.ttlSeconds;
    }
    const seconds = Math.ceil((expires - Date.now()) / 1000);
    return Math.max(seconds, 1);
  }
}

module.exports = {
  CouchbaseSessionStore
};
