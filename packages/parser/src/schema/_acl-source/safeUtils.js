const crypto = require('crypto');
const {getCommonData} = require("../global");
// const key = crypto.randomBytes(32); // AES-256 密钥
// const iv = crypto.randomBytes(16); // 128 比特的初始化向量

/**
 * AES加密逻辑
 * @param localData 加密数据
 * @returns {Promise<string>}
 */
const encrypt = async (localData) => {
  const common = await getCommonData();
  const key32 = getKeyIv(common.openid, 'sha256', 32);
  const iv16 = getKeyIv(common.openid, 'sha256', 16);
  return encryptData('aes-256-cbc', key32, iv16, localData);
};

/**
 * AES解密逻辑
 * @param encryptedText 解密数据
 * @returns {Promise<string>}
 */
const decrypt = async (encryptedText) => {
  const common = await getCommonData();
  const key32 = getKeyIv(common.openid, 'sha256', 32);
  const iv16 = getKeyIv(common.openid, 'sha256', 16);
  return decryptData('aes-256-cbc', key32, iv16, encryptedText);
};

/**
 * WeGame加密逻辑
 * @param localData 加密数据
 * @returns {Promise<string>}
 */
const weGameEncrypt = async (localData) => {
  const common = await getCommonData();
  const key16 = getKeyIv(common.gopenid, 'sha256', 16);
  const iv16 = getKeyIv(common.gopenid, 'sha256', 16);
  return encryptData('aes-128-cbc', key16, iv16, localData);
};

const weGameDecrypt = async (localData) => {
  const common = await getCommonData();
  const key16 = getKeyIv(common.gopenid, 'sha256', 16);
  const iv16 = getKeyIv(common.gopenid, 'sha256', 16);
  return decryptData('aes-128-cbc', key16, iv16, localData);
};

const getKeyIv = (openid, algorithm, length) => {
  const hash = crypto.createHash(algorithm);
  hash.update(openid);
  const key32 = hash.digest('hex').substring(0, length);
  return Buffer.from(key32, 'utf8');
};


/**
 * 加密逻辑
 * @param algorithm 对应的加密算法
 * @param key
 * @param iv
 * @param plaintext
 * @returns {string} 加密之后的密文数据
 */
const encryptData = (algorithm, key, iv, plaintext) => {
  const cipher = crypto.createCipheriv(algorithm, key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return encrypted;
};

/**
 * 解密逻辑
 * @param algorithm 对应的解密算法
 * @param key
 * @param iv
 * @param plaintext
 * @returns {string} 解密之后的明文数据
 */
const decryptData = (algorithm, key, iv, plaintext) => {
  const decipher = crypto.createDecipheriv(algorithm, key, iv);
  let decrypted = decipher.update(plaintext, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
};


module.exports = {
  encrypt, decrypt, weGameEncrypt, weGameDecrypt
};