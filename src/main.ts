import { listSource } from './source';

function globalVariables() {
  /***********************************************************************************************
   * 뉴스봇 구동에 필요한 설정값들입니다. 아래 설명을 참고하시어 입력해주세요.
   * *********************************************************************************************
   * DEBUG           : 디버그 모드 ON/OFF (true/false로만 입력, 기본값: false)
   *
   * clientId        : 네이버 검색 오픈 API 접근 가능한 Client ID 값
   * clientSecret    : 네이버 검색 오픈 API 접근 가능한 Client Secret 값
   *
   * keyword         : 모니터링할 네이버 뉴스 검색어
   *
   * TELEGRAM_BOT_TOKEN: 네이버 뉴스 전송에 사용되는 텔레그램 봇 토큰 값
   * TELEGRAM_CHAT_ID: 네이버 뉴스를 전송할 채팅방 ID 값
   * *********************************************************************************************/

  return {
    // 디버그 모드 설정
    DEBUG: false,

    // 네이버 검색 오픈 API Client ID 및 Secret 값
    clientId: '[네이버 오픈 API용 Client ID]',
    clientSecret: '[네이버 오픈 API용 Client Secret]',

    // 네이버 뉴스 검색어
    keyword: '문가영',

    // Telegram 설정
    TELEGRAM_BOT_TOKEN: '[TELEGRAM_BOT_TOKEN]',
    TELEGRAM_CHAT_ID: '[TELEGRAM_CHAT_ID]',
  };
}

/***************************************************************************
 * 여기서부터는 꼭 필요한 경우가 아니라면 수정하지 말아주세요.
 * *************************************************************************/

function getFeedUrl(keyword: string, startup: boolean) {
  // 뉴스 검색 결과 출력 건수 지정 (미지정시 기본값 10, 최대 100; 권장값 10~50)
  const display = '50';

  // 뉴스 검색 시작 위치 지정 (미지정시 기본값 1, 최대 1000; 권장값 1)
  const start = '1';

  // 뉴스 검색결과 정렬 옵션 (미지정시 기본값 date(날짜순), 이외에 sim(유사도순) 지정 가능하나 비추천)
  const sort = 'date';

  // 키워드 매개변수를 URL에서 올바르게 표현하기 위해 URL 인코딩합니다.
  const encodedKeyword = encodeURIComponent(keyword);

  // 뉴스봇을 최초로 실행한 경우에는 피드 체크 용도로 위의 설정값과 무관하게 가장 최신의 1개 뉴스만 전송한다.
  if (startup) {
    return `https://openapi.naver.com/v1/search/news.xml?query=${encodedKeyword}&display=1&start=1&sort=date`;
  }
  return `https://openapi.naver.com/v1/search/news.xml?query=${encodedKeyword}&display=${display}&start=${start}&sort=${sort}`;
}

function getFeed(keyword: string, clientId: string, clientSecret: string, startup = false) {
  const feedUrl = getFeedUrl(keyword, startup);
  const options: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions = {
    method: 'get',
    headers: {
      'X-Naver-Client-Id': clientId,
      'X-Naver-Client-Secret': clientSecret,
    },
  };

  return UrlFetchApp.fetch(feedUrl, options);
}

function getSource(originallink: string) {
  // source.gs에 저장된 언론사별 URL 리스트를 가져온다.
  const list = listSource();

  // 넘겨받은 뉴스 원문 주소에서 불필요한 부분을 제거한다.
  const address = originallink
    .toLowerCase()
    .replace(
      /^(https?:\/?\/?)?(\/?\/?www\.)?(\/?\/?news\.)?(\/?\/?view\.)?(\/?\/?post\.)?(\/?\/?photo\.)?(\/?\/?photos\.)?(\/?\/?blog\.)?/,
      ''
    );
  const domainMatch = address.match(/^([^:\/\n\?\=]+)/);

  // 원문 주소에 맞는 매체명을 탐색하여 리턴한다. 탐색 결과가 없을 경우 원문이 실린 도메인 주소를 리턴한다.
  const index = searchSourceIndex(address, list);
  if (index >= 0 && index <= list.length - 1) {
    return list[index][1];
  } else if (domainMatch) {
    return domainMatch[0];
  } else {
    return '(알수없음)';
  }
}

function searchSourceIndex(address: string, list: string[][]) {
  let left = 0;
  let right = list.length - 1;

  while (left <= right) {
    let index = Math.floor((left + right) / 2);
    let address_stripped = address.substr(0, list[index][0].length);

    if (address_stripped === list[index][0]) {
      return checkSourceIndex(index, list, address, address_stripped);
    } else if (address_stripped < list[index][0]) {
      right = index - 1;
    } else {
      left = index + 1;
    }
  }

  return -1;
}

function checkSourceIndex(
  index: number,
  list: string[][],
  address: string,
  address_stripped: string
) {
  let i = index;

  // addressSearch()에서 확인된 매체명 경로를 포함하는 하위 경로가 추가로 존재하는지 체크한다.
  while (i + 1 <= list.length - 1) {
    if (list[i + 1][0].includes(address_stripped)) {
      i++;
    } else {
      break;
    }
  }

  // 추가 하위 경로가 없다면 원래의 매체명 index값을 리턴한다.
  if (i === index) {
    return index;
  }

  // 만약 있다면, 해당되는 범위의 우측 끝에 위치한 매체명부터 차례로 체크한 뒤 조건에 맞는 매체명 index값을 리턴한다.
  while (i >= index) {
    if (address.includes(list[i][0])) {
      return i;
    }
    i--;
  }

  return -1;
}

function getArticle(
  g: ReturnType<typeof globalVariables>,
  feed: GoogleAppsScript.URL_Fetch.HTTPResponse,
  lastArticleUpdateTime: number | null
) {
  // 뉴스 검색 결과물을 가져와 item 단위로 시간순 정렬시키고 Fetching 작업을 시작한다.
  const xml = XmlService.parse(feed.getContentText());
  const items = xml.getRootElement().getChild('channel').getChildren('item').reverse();

  let cnt = 0;

  for (let i = 0; i < items.length; i++) {
    const pubDate = new Date(items[i].getChildText('pubDate'));

    if (!lastArticleUpdateTime || pubDate.getTime() > lastArticleUpdateTime) {
      // 각 item 별로 데이터 필드들을 가져온다.
      const title = bleachText(items[i].getChildText('title'));
      const link = items[i].getChildText('link');
      const source = getSource(items[i].getChildText('originallink'));
      const description = bleachText(items[i].getChildText('description'));
      const pubDateText = Utilities.formatDate(pubDate, 'GMT+9', 'yyyy-MM-dd HH:mm:ss');

      // DEBUG 모드일 경우 => 뉴스봇 기능을 정지하고 처리된 데이터를 로그로만 출력시킨다.
      if (g.DEBUG) {
        Logger.log('----- ' + items.length + '개 항목 중 ' + (i + 1) + '번째 -----');
        Logger.log(`${source}, ${pubDateText}\n${title}\n${description}\n${link}`);
      }

      // DEBUG 모드가 아닐 경우 => 뉴스봇 기능을 실행한다.
      else {
        if (title.includes('문가영')) {
          Logger.log("'" + title + "' 항목 게시 중...");
          postArticle(g, pubDateText, title, source, link);
          cnt++;
        } else {
          Logger.log(`'${title}' 항목은 문가영님과 관련된 주요 기사가 아닙니다.`);
        }
      }

      // PropertiesService 객체에 마지막 뉴스 업데이트 시점을 새로 업데이트한다.
      setProperty('lastArticleUpdateTime', `${pubDate.getTime()}`);
    }
  }

  if (cnt === 0) {
    let lastPubTime = getProperty('lastArticleUpdateTime');
    if (!lastPubTime) {
      throw new Error('가장 최신 뉴스의 업로드 시간을 불러오는 도중 에러가 발생했습니다.');
    }
    const lastPubDateText = Utilities.formatDate(
      new Date(+lastPubTime),
      'GMT+9',
      'yyyy-MM-dd HH:mm:ss'
    );
    Logger.log(`${lastPubDateText} 이후, 업데이트된 최신 기사가 없습니다.`);
  } else {
    Logger.log(`* 총 ${cnt} 건의 항목이 게시되었습니다.`);
  }
}

function createArticleTemplate(pubDateText: string, title: string, source: string, link: string) {
  return `<b>${title}</b>\n- ${source}, ${pubDateText}\n\n${link}`;
}

function postArticle(
  g: ReturnType<typeof globalVariables>,
  pubDateText: string,
  title: string,
  source: string,
  link: string
) {
  try {
    const url = `https://api.telegram.org/bot${g.TELEGRAM_BOT_TOKEN}/sendMessage`;
    const params: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions = {
      method: 'post',
      payload: {
        chat_id: g.TELEGRAM_CHAT_ID,
        text: createArticleTemplate(pubDateText, title, source, link),
        parse_mode: 'HTML',
        link_preview_options: JSON.stringify({ url: link, prefer_large_media: true }),
      },
    };

    UrlFetchApp.fetch(url, params);
  } catch (error) {
    Logger.log(error);
    throw new Error('텔레그램 메세지를 전송하는 과정에서 에러가 발생했습니다.');
  }
}

function bleachText(text: string) {
  // 데이터 필드에 포함된 HTML Tag를 제거하고 Entity들을 원래 의도된 특수문자로 대체한다.
  text = text.replace(/(<([^>]+)>)/gi, '');
  text = text.replace(/&quot;/gi, '"');
  text = text.replace(/&#039;/gi, "'");
  text = text.replace(/&lt;/gi, '<');
  text = text.replace(/&gt;/gi, '>');
  text = text.replace(/&amp;/gi, '&');
  text = text.replace(/`/gi, "'");
  text = text.replace(/&apos;/gi, "'");

  return text;
}

function getProperty(property: string) {
  // PropertiesService 객체에 지정된 property 속성값이 있다면 이를 리턴한다.
  return PropertiesService.getScriptProperties().getProperty(property);
}

function setProperty(property: string, value: string) {
  // PropertiesService 객체에 property 속성값으로 value를 입력한다.
  PropertiesService.getScriptProperties().setProperty(property, value);
}

function runFetchingBot() {
  // 뉴스봇 구동 설정값들을 불러온다.
  const g = globalVariables();

  // 네이버 검색 오픈 API Client ID 및 Secret 값을 체크한다.
  if (!g.clientId || !g.clientSecret) {
    Logger.log('* 네이버 검색 오픈 API의 Client ID 및 Secret 설정값을 다시 확인해주세요.\n');
    return;
  }

  // 네이버 뉴스 검색 키워드 유무를 확인한다.
  if (!g.keyword) {
    Logger.log('* 뉴스를 검색하실 키워드를 설정해주세요.\n');
    return;
  }

  // 뉴스를 전달할 텔레그램 봇과 채팅방이 없을 경우, 에러 로그와 함께 실행을 종료한다.
  if (!g.TELEGRAM_BOT_TOKEN || !g.TELEGRAM_CHAT_ID) {
    Logger.log('* 텔레그램 뉴스봇과 관련된 설정값이 비어있습니다. \n');
    return;
  }

  // PropertiesService 객체에 저장된 lastArticleUpdateTime 속성값이 있는지 체크한다.
  const lastArticleUpdateTime = getProperty('lastArticleUpdateTime');
  let feed: GoogleAppsScript.URL_Fetch.HTTPResponse;

  // lastArticleUpdateTime 속성값의 유무로 뉴스봇 최초 실행 여부를 판단하고 뉴스 피드를 받아온다.
  if (!lastArticleUpdateTime) {
    feed = getFeed(g.keyword, g.clientId, g.clientSecret, true);
    Logger.log('* 뉴스봇 초기 설정을 시작합니다.\n');
  } else {
    feed = getFeed(g.keyword, g.clientId, g.clientSecret);
  }

  // 네이버 뉴스 피드를 체크하고, 피드의 응답 코드가 정상(200)이라면 뉴스봇 기능을 구동한다.
  if (feed.getResponseCode() == 200) {
    getArticle(g, feed, Number(lastArticleUpdateTime));
  }

  // 200 이외의 응답 코드가 리턴될 경우 에러 체크를 위한 헤더 및 내용을 로그로 출력시킨다.
  else {
    Logger.log('* 뉴스를 가져오는 과정에서 에러가 발생했습니다. 로그를 참고해주세요.\n');
    Logger.log(feed.getHeaders());
    Logger.log(feed.getContentText());
    return;
  }
}
