'use strict';

const debug = require('debug')('serialize-json#JSONDecoder');

const TOKEN_TRUE = -1;
const TOKEN_FALSE = -2;
const TOKEN_NULL = -3;
const TOKEN_EMPTY_STRING = -4;
const TOKEN_UNDEFINED = -5;

const REG_STR_REPLACER = /\+|%2B|%7C|%5E|%25/g;
const DECODER_REPLACER = {
  '+': ' ',
  '%2B': '+',
  '%7C': '|',
  '%5E': '^',
  '%25': '%',
};
const TOKEN_SET = new Set([ '|', '$', '@', '*', '#', ']' ]);

class JSONDecoder {
  constructor() {
    this.dictionary = [];
    this.tokens = [];
    this.tokensIndex = 0;
  }

  _decodeString(str) {
    return str.replace(REG_STR_REPLACER, a => DECODER_REPLACER[a]);
  }

  _decodeDate(str) {
    return new Date(this._base36To10(str));
  }

  _base36To10(num) {
    return parseInt(num, 36);
  }

  _unpack() {
    const token = this.tokens[this.tokensIndex];
    switch (token) {
      case '@': // array
      {
        debug('--> unpack array begin');
        const arr = [];
        const tokensLen = this.tokens.length;
        for (this.tokensIndex++; this.tokensIndex < tokensLen; this.tokensIndex++) {
          const token = this.tokens[this.tokensIndex];
          if (token === ']') {
            debug('--> unpack array end, %j', arr);
            return arr;
          }
          arr.push(this._unpack());
        }
        return arr;
      }
      case '$': // object
      {
        debug('--> unpack plain object begin');
        const obj = {};
        const tokensLen = this.tokens.length;
        for (this.tokensIndex++; this.tokensIndex < tokensLen; this.tokensIndex++) {
          const token = this.tokens[this.tokensIndex];
          if (token === ']') {
            debug('--> unpack plain object end, %j', obj);
            return obj;
          }
          const key = this._unpack();
          this.tokensIndex++;
          obj[key] = this._unpack();
        }
        return obj;
      }
      case '*': // buffer
      {
        debug('--> unpack buffer begin');
        const arr = [];
        const tokensLen = this.tokens.length;
        for (this.tokensIndex++; this.tokensIndex < tokensLen; this.tokensIndex++) {
          const token = this.tokens[this.tokensIndex];
          if (token === ']') {
            debug('--> unpack buffer end, %j', arr);
            return Buffer.from(arr);
          }
          arr.push(this._unpack());
        }
        return Buffer.from(arr);
      }
      case '#': // error
      {
        debug('--> unpack error begin');
        const obj = {};
        const tokensLen = this.tokens.length;
        for (this.tokensIndex++; this.tokensIndex < tokensLen; this.tokensIndex++) {
          const token = this.tokens[this.tokensIndex];
          if (token === ']') {
            const err = new Error(obj.message);
            Object.assign(err, obj);
            debug('--> unpack error end, %j', err);
            return err;
          }
          const key = this._unpack();
          this.tokensIndex++;
          obj[key] = this._unpack();
        }
        const err = new Error(obj.message);
        Object.assign(err, obj);
        return err;
      }
      case TOKEN_TRUE:
        return true;
      case TOKEN_FALSE:
        return false;
      case TOKEN_NULL:
        return null;
      case TOKEN_EMPTY_STRING:
        return '';
      case TOKEN_UNDEFINED:
        return undefined;
      default:
        return this.dictionary[token];
    }
  }

  decode(buf) {
    this.dictionary = [];
    this.tokens = [];
    this.tokensIndex = 0;

    const packed = buf.toString();

    const total = packed.length;

    let curPos = 0;
    let curCategoryIndex = 0;
    let char = '';
    let charBuf = [];

    const push = ()=> {
      if (charBuf.length > 0) {
        const str = charBuf.join('');
        // string
        if (curCategoryIndex === 0) {
          this.dictionary.push(this._decodeString(str));
        }
        // int
        if (curCategoryIndex === 1) {
          this.dictionary.push(this._base36To10(str));
        }
        // float
        if (curCategoryIndex === 2) {
          this.dictionary.push(parseFloat(str));
        }
        // date
        if (curCategoryIndex === 3) {
          this.dictionary.push(this._decodeDate(str));
        }
        charBuf = [];
      }
    };

    const pushToken = () => {
      if (charBuf.length > 0) {
        const str = charBuf.join('');
        this.tokens.push(this._base36To10(str));
        charBuf = [];
      }
    };

    while (curPos < total) {
      char = packed.charAt(curPos);
      curPos++;

      if (char === '^') {
        push();
        curCategoryIndex++;
        continue;
      }

      if (curCategoryIndex === 4) {
        debug('decode packed json => %s, with dictionary %j', packed, this.dictionary);

        if (TOKEN_SET.has(char)) {
          pushToken();
          if (char !== '|') {
            this.tokens.push(char);
          }
        } else {
          charBuf.push(char);
        }

        continue;
      }

      if (char === '|') {
        push();
        continue;
      }

      if (char) {
        charBuf.push(char);
      }
    }

    pushToken();
    return this._unpack();
  }
}

module.exports = JSONDecoder;
