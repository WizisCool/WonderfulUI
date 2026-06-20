const fs = require("fs-extra");
const {join} = require("path");
const {homedir, platform} = require("os");
const {encrypt, decrypt, weGameEncrypt} = require("./utils/safeUtils");
const {getCommonData} = require("./global");
const {mkdirSSync} = require("./utils/util");
const {dataFilter} = require("./utils/dataUtil");
const {KEY_WONDERFUL_LIST, KEY_SNAPSHOT_LIST} = require("./wonderful/wonderfulConstants");

const DB_WONDERFUL = '';//精彩时刻视频本地存储的db前缀 ！！勿修改
const DB_SNAPSHOT = 'snapshot';//一键截图本地存储的db前缀 ！！勿修改

const initLocalFile = async (data, source) => {
  console.log("local文件不存在，正在创建");
  await write(await getLocalPath(source), data);
};

const read = async (localFile) => {
  const common = await getCommonData();
  if (common == null || common.openid == null || typeof common.openid !== 'string') {
    return "{}";
  }
  return await decrypt(fs.readFileSync(localFile, {encoding: "utf-8"}));
};

const write = async (localFile, data) => {
  try {
    const common = await getCommonData();
    if (common == null || common.openid == null || typeof common.openid !== 'string') {
      return;
    }
    const result = await encrypt(JSON.stringify(data));
    fs.writeFileSync(localFile, result);
  } catch (e) {
    console.log(`write local file error ${localFile}, e: ${e}`);
  }
};
/**
 * 实现本地持久化数据的获取
 * @param {string} prop
 * @returns value，对象
 */
const get = async (prop) => {
  let source = '';
  if (prop.startsWith(KEY_WONDERFUL_LIST)) {
    source = DB_WONDERFUL;
  } else if (prop.startsWith(KEY_SNAPSHOT_LIST)) {
    source = DB_SNAPSHOT;
  }
  const objectData = await getStorage(prop, source);
  return objectData;
};

const getStorage = async (prop, source) => {
  let data = {};
  try {
    data = await read(await getLocalPath(source));
  } catch {
    await initLocalFile(data, source);
    return null;
  }
  try {
    let json = JSON.parse(data);
    return json[prop];
  } catch (e) {
    return null;
  }
};

/**
 * 实现数据的本地持久化
 * @param {string} prop
 * @param {object} value
 */
const set = async (prop, value) => {
  let source = '';
  if (prop.startsWith(KEY_WONDERFUL_LIST)) {
    try {
      await setWeGameData(prop, value);
    } catch (e) {
      console.log('WeGame wonderful data error', e);
    }
    source = DB_WONDERFUL;
  } else if (prop.startsWith(KEY_SNAPSHOT_LIST)) {
    source = DB_SNAPSHOT;
  }
  await setStorage(prop, value, source);
};

const setStorage = async (prop, value, source) => {
  let data = {};
  try {
    data = await read(await getLocalPath(source));
  } catch {
    await initLocalFile(data, source);
  }
  let json = JSON.parse(data);
  json[prop] = value;
  await write(await getLocalPath(source), json);
};

/**
 * 设置WeGame的简版数据
 * @param {string} prop
 * @param {object} value
 */
const setWeGameData = async (prop, value) => {
  let data = {};
  try {
    const common = await getCommonData();
    if (common == null || common.gopenid == null || typeof common.gopenid !== 'string') {
      return;
    }
    data[prop] = dataFilter(value);
    const result = await weGameEncrypt(JSON.stringify(data));
    const filePath = await getWeGameLocalPath();
    const tmpFilePath = `${filePath}.tmp`;
    fs.writeFileSync(tmpFilePath, result);
    fs.renameSync(tmpFilePath, filePath);
  } catch {
    console.log('WeGame wonderful data error', e);
  }
};

/**
 * 增加分文件存储db
 * @param source 存储db前缀
 * @returns {Promise<string>}
 */
const getLocalPath = async (source = DB_WONDERFUL) => {
  let localPath = `./${source}wonderful_db`;
  if (platform() === 'win32') {
    const folderPath = join(homedir(), 'AppData/Roaming/ACLOS/WonderfulDb/');
    mkdirSSync(folderPath);
    const commonData = await getCommonData();
    localPath = join(homedir(), 'AppData/Roaming/ACLOS/WonderfulDb/' + source + commonData.openid);
  }
  return localPath;
};

const getWeGameLocalPath = async () => {
  let localPath = './we_game_db';
  if (platform() === 'win32') {
    const folderPath = join(homedir(), 'AppData/Roaming/ACLOS/WeGameWonderfulDb/');
    if (!fs.existsSync(folderPath)) {
      mkdirSSync(folderPath);
    }
    const commonData = await getCommonData();
    localPath = join(homedir(), 'AppData/Roaming/ACLOS/WeGameWonderfulDb/' + commonData.gopenid);
  }
  return localPath;
};


module.exports = {
  get,
  set,
  getWeGameLocalPath
};
