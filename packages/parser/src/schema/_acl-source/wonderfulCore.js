const {post} = require("../network/request");
const {logger, delFileSync} = require("../utils/util");

const {Match} = require("../events/eventDefine");
const {updateMatheGlobalData} = require("../events/globalAnalysis");
const {getGlobalData} = require("../common/globalData");

const wonderfulHelper = require("./wonderfulHelper");
const storage = require("../storage");
const urlConstants = require("../network/urlConstants");
const wonderfulStat = require("./wonderfulStat");

let isConsume = true;//是否需要更新本地精彩时刻
let isCloudConsume = true;//是否需要更新云端精彩时刻
const {sendIpc} = require("../global");

/**
 * 存储本地精彩时刻列表
 * @param {Array} wonderfulData  !!需要传入一个数据列表
 * @returns {Promise<Boolean>} Promise 异步操作，设置成功返回当前设置的数据
 */
const setLocalWonderfulList = function ({wonderfulData}) {
  return new Promise((resolve, reject) => {
    wonderfulHelper.getWonderfulKey().then(async (key) => {
      await storage.set(key, wonderfulData);
      resolve(wonderfulData);
    }).catch(reject);
  });
};

/**
 * 查询本地精彩时刻列表，只有查询完整列表的时候才会返回是否上传云端
 * @param matches_id 需要查询的精彩时刻对局id，不传或传空则查询本地所有精彩时刻
 * @param cloudList 云端精彩时刻防止循环调用，内部使用，外部忽略
 * @returns {Promise<Array>} 满足条件的精彩时刻列表
 */
const getLocalWonderfulList = function ({matches_id = []}, cloudList = null) {
  return new Promise((resolve, reject) => {
    wonderfulHelper.getWonderfulKey().then(async (key) => {
      let localList = await storage.get(key);
      if (localList == null) {
        resolve([]);
        return;
      }
      if (matches_id.length === 0) {
        if (cloudList != null) {
          wonderfulHelper.resetIsUpload(localList, cloudList);
          resolve(localList);
        } else {
          //查询云端精彩时刻
          getCloudWonderfulList().then((result) => {
            wonderfulHelper.resetIsUpload(localList, result);
            resolve(localList);
          }).catch(reject);
        }
        return;
      }
      const needList = localList.filter((item, i, arr) => {
        return matches_id.indexOf(item.matches_id) > -1;
      });
      resolve(needList);
    }).catch(reject);
  });
};

/**
 * 删除本地的精彩时刻
 * @param {String} matches_id 对局id
 * @param {String} video_id 视频id
 * @returns {Promise<Object>} Promise 异步操作，删除啊成功返回当前删除的对局信息
 */
const delLocalWonderful = function ({matches_id, video_id}) {
  return new Promise(async (resolve, reject) => {
    logger('delLocalWonderful==' + matches_id + '===' + video_id);
    multipleDelLocalWonderful([{matches_id: matches_id, video_id: video_id}]).then((data) => {
      resolve(data[0]);
    }).catch(reject);
  });
};

/**
 * 多个本地视频删除
 * @param delList 需要删除的本地视频列表 e.g:[{matches_id:'', video_id:''}]
 * @returns {Promise<Array>} 返回删除之后的对局数据
 */
const multipleDelLocalWonderful = (delList) => {
  return new Promise(async (resolve, reject) => {
    logger('multipleDelLocalWonderful size: ' + delList.length);
    const localList = await getLocalWonderfulList({}, []);
    const delVideoList = [];
    const repVideoDict = [];
    
    for (const videoInfo of delList) {
      const realMatchesData = await singleDelLocalWonderful(localList, videoInfo.matches_id, videoInfo.video_id);
      if (realMatchesData != null) {
        delVideoList.push(realMatchesData);
        //
        if (repVideoDict[videoInfo.matches_id]) {
          repVideoDict[videoInfo.matches_id].push(videoInfo.video_id);
        } else {
          repVideoDict[videoInfo.matches_id] = [videoInfo.video_id];
        }
      }
    }
    
    await setLocalWonderfulList({wonderfulData: localList});
    
    let repWonderfulData = [];
    for (const matches_id in repVideoDict) {
      repWonderfulData.push({
        matches_id: matches_id,
        videos: repVideoDict[matches_id]
      });
    }
    await wonderfulStat.reportVideoStat(repWonderfulData, false);
    
    setIsConsume(true);
    sendIpc({type: 'localVideo', action: 'update'});
    sendIpc({type: 'cloudVideo', action: 'update'});
    resolve(delVideoList);
  });
};

const singleDelLocalWonderful = (localList, matches_id, video_id) => {
  return new Promise(async (resolve, reject) => {
    if (localList.length === 0) {
      resolve(null);
      return;
    }
    const realMatchesData = wonderfulHelper.getWonderfulSingleData(localList, matches_id, video_id);
    if (realMatchesData != null) {
      const videos = realMatchesData.videos;
      const index = videos.findIndex(item => item.video_id === video_id);
      //判断当前视频是否存在，删除当前视频数据
      const delVideoOk = delFileSync(videos[index].video_src);
      const delPosterOk = delFileSync(videos[index].video_poster);
      if (!delVideoOk || !delPosterOk) {
        logger('del video error: ' + videos[index].video_src);
        return;
      }
      //删除.tmp文件夹
      const matchesDir = await wonderfulHelper.getWonderfulPath(matches_id);
      wonderfulHelper.removeDirTemp(matchesDir);
      videos.splice(index, 1);
      if (videos.length === 0) {
        //视频为空的情况下，删除当前对局
        const matchesIndex = localList.findIndex(item => item.matches_time === realMatchesData.matches_time);
        localList.splice(matchesIndex, 1);
        logger('删除对局信息' + matches_id);
        //多个相同对局ID，无法删除文件夹。
        // try {
        //   fs.rmSync(path.join(await wonderfulHelper.getWonderfulDir(), matches_id), {recursive: true, force: true});
        //   logger("全局文件夹已成功删除");
        // } catch (error) {
        //   logger("全局删除文件夹失败:", error);
        // }
      }
      resolve(realMatchesData);
    } else {
      resolve(null);
    }
  });
};

/**
 * 获取云端的精彩时刻列表
 * @returns {Promise<Array>} Promise 异步操作
 */
const getCloudWonderfulList = () => {
  return new Promise((resolve, reject) => {
    let params = {};
    post(urlConstants.GET_USER_VIDEOS_MERGED, params).then(async (result) => {
      if (result != null && Array.isArray(result)) {
        const localList = await getLocalWonderfulList({}, result);
        wonderfulHelper.setDownloadStatus(result, localList);//设置当前云端的状态，是否下载。
        resolve(result);
      } else {
        resolve(result);
      }
    }).catch(reject);
  });
};

/**
 * 删除云空间精彩时刻
 * @param {Array<String>} file_ids 需要删除的文件id列表
 * @param {Array<String>} vids     需要删除的腾讯视频id列表
 * @returns {Promise<Object>} Promise 异步操作
 */
const delCloudWonderful = ({file_ids = [], vids = []}) => {
  return new Promise((resolve, reject) => {
    if (file_ids.length === 0 && vids.length === 0) {
      reject('ID列表为空');
    }
    let params;
    let urlPath;
    if (file_ids.length !== 0) {
      params = {file_ids: file_ids};
      urlPath = urlConstants.DELETE_WONDERFUL_LIST;
    } else {
      params = {vids: vids};
      urlPath = urlConstants.DEL_USER_VIDS;
    }
    post(urlPath, params).then((data) => {
      resolve(data);
      isCloudConsume = true;
      sendIpc({type: 'localVideo', action: 'update'});
      sendIpc({type: 'cloudVideo', action: 'update'});
    }).catch(reject);
  });
};

const setIsConsume = (status) => {
  logger(`consume status change : ${(status) ? 'need consume local' : 'consume local success'}`);
  isConsume = status;
};

const getIsConsume = () => {
  if (isConsume) {
    setIsConsume(false);
    return true;
  } else {
    return false;
  }
};

const setIsCloudConsume = (status) => {
  logger(`consume status change : ${(status) ? 'need consume cloud' : 'consume cloud success'}`);
  isCloudConsume = status;
};

const getIsCloudConsume = () => {
  if (isCloudConsume) {
    setIsCloudConsume(false);
    return true;
  } else {
    return false;
  }
};


/**
 * 通过 [videoId] [matchesId] 查找 wonderful 整个数据
 *
 * @param matchesId            对局id
 * @param videoId              被裁剪的视频id
 * @returns {Promise<null|*>}  整个事件数据
 */
const queryWonderfulData = async ({matchesId, videoId}) => {
  const matchesList = await getLocalWonderfulList({matches_id: [matchesId]}, []);
  const wonderfulData = wonderfulHelper.getWonderfulSingleData(matchesList, matchesId, videoId);
  if (wonderfulData == null) {
    let msg = `findWonderfulData not found matched data by matches_id:${matchesId} video_id:${videoId}`;
    logger(msg);
    return null;
  }
  return wonderfulData;
};

/**
 * 根据 [videoId] [matchesId]查找数据库中目标 [VideoDetail]
 *
 * @param matchesId            对局id
 * @param videoId              被裁剪的视频id
 * @returns {null|T}           被裁剪片段对应的数据
 */
const queryVideoDetail = async ({matchesId, videoId}) => {
  let wonderfulData = await queryWonderfulData({matchesId, videoId});
  if (wonderfulData == null || wonderfulData.videos == null) {
    let msg = `findVideoDetail not found matched data by matches_id:${matchesId} video_id:${videoId}`;
    logger(msg);
    return null;
  }
  return wonderfulData.videos.find(video => video.video_id === videoId);
};

/**
 * 插入一个视频数据到在 同级 videoId 所对应的对局里面
 *
 * @param matchesId             对局 id
 * @param broVideoId            所需要插入的 videoDetail 对应的同级 videoId
 * @param videoDetail           新的视频片段数据
 * @returns {Promise<void>}
 */
const insertVideoDetail = async ({matchesId, broVideoId, videoDetail}) => {
  const localList = await getLocalWonderfulList({}, []);
  let matchesData = wonderfulHelper.getWonderfulSingleData(localList, matchesId, broVideoId);
  matchesData.videos.push(videoDetail);
  afterInsertVideoAction(localList, matchesId)
};

/**
 * 插入 VideoDetail 数据，检索数据库两种情况
 *  - 存在相同的对局则插入 VideoDetail
 *  - 不存在对局向构造对局数据再插入 VideoDetail
 *
 * @param matchesId         对局 id
 * @param videoDetail       目标数据
 * @returns {Promise<void>}
 */
const insetVideoDetailWithMatch = async ({matchesId, videoDetail}) => {
  const matchList = await getLocalWonderfulList({}, []);
  const oldMatches = matchList.find((item, i, arr) => {
    return item.matches_id === matchesId;
  });
  
  const notSame = () => {
    logger('[insetVideoDetailWithMatch] not same matches, will create a new Matches data.');
    const match = new Match();
    updateMatheGlobalData(match, getGlobalData())
    match.videos = [videoDetail]
    matchList.push(match)
    afterInsertVideoAction(matchList, matchesId)
  }
  
  const same = async () => {
    logger('[insetVideoDetailWithMatch] is same matches, will insert.');
    if (oldMatches.videos.length === 0) { // 理论上这种情况不会存在
      logger('old matches video is empty')
    } else {
      let videoId = oldMatches.videos[0].video_id
      await insertVideoDetail({
        matchesId: matchesId,
        broVideoId: videoId,
        videoDetail: videoDetail
      })
    }
  }
  
  oldMatches == null ? notSame() : await same()
};


const afterInsertVideoAction = (matchList, matchesId) => {
  setIsConsume(true);
  sendIpc({type: 'localVideo', action: 'update'});
  setLocalWonderfulList({wonderfulData: matchList}).then((_) => {
    logger(`insert video detail to local success, matchesId: ${matchesId}`);
  }).catch((error) => {
    logger(`insert  video detail to local failed,error: ${error}`);
  });
}

/**
 * 生成的 Match 数据，在一些情况下，可能会使用同一个 matches_id，需要将其合并成一个 Match 数据
 * @param match               原始的 Match 数据
 * @returns {Promise<Array>}  合并后的本地精彩时刻的数据
 */
const mergeMatchInWonderfulLocal = async (match) => {
  /**
   * 原有的数据 videoName 已经有相同的了需要重新更名一波
   * @param videos
   */
  const fixVideoName = (videos) => {
    let tempVideos = [];
    videos.forEach((video) => {
      tempVideos.push(video);
      video.video_name = video.video_type; // 先去除原先的索引
      video.video_name += getVideoIndex(tempVideos, video.video_type);
    });
  };
  
  /**
   * 获取'video_name'后面的索引值，1 的话不展示
   *
   * @param videos
   * @param videoType    片段类型
   * @returns {string}   对局数据中对应视频片段中包含 '对应type' 的片段数量
   */
  const getVideoIndex = function (videos, videoType) {
    if (videos == null || videos.length <= 1) {
      return '';
    }
    return (videos.filter(video => video.video_type === videoType).length).toString();
  };
  
  let currentList = await getLocalWonderfulList({}, []);
  let sameMatch = currentList.find((item) => {
    return match.matches_id === item.matches_id;
  });
  if (sameMatch) {
    logger('[WonderfulCore] current match has same match info in local wonder list, so merge it!');
    sameMatch.videos.push(...match.videos);
    fixVideoName(sameMatch.videos);
  } else {
    currentList.push(match);
  }
  return currentList;
};

module.exports = {
  setLocalWonderfulList,
  getLocalWonderfulList,
  delLocalWonderful,
  getCloudWonderfulList,
  delCloudWonderful,
  queryWonderfulData,
  queryVideoDetail,
  insertVideoDetail,
  insetVideoDetailWithMatch,
  getIsConsume,
  setIsConsume,
  getIsCloudConsume,
  setIsCloudConsume,
  multipleDelLocalWonderful,
  mergeMatchInWonderfulLocal
};
