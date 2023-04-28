const https = require("https");
const axios = require("axios");
const moment = require("moment");
const fs = require("fs");

const BEARER_TOKEN = "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Safari/537.36";

function getMonthsBetweenGivenDates(startDate, endDate) {
  startDate = moment(startDate);
  endDate = moment(endDate);
  const months = [];

  let currentDate = startDate.clone();
  while (currentDate <= endDate) {
    const startOfMonth = currentDate.clone().startOf("month");
    const endOfMonth = currentDate.clone().endOf("month");

    months.push({
      start_date: startOfMonth.format("YYYY-MM-DD"),
      end_date: endOfMonth.format("YYYY-MM-DD"),
    });

    currentDate.add(1, "month").startOf("month");
  }

  return months;
}

const getGuestToken = async () => {
  const response = await axios.get("https://twitter.com", {
    headers: {
      "User-Agent": USER_AGENT,
    },
    httpsAgent: new https.Agent({
      minVersion: "TLSv1.3",
    }),
  });
  const cookies = response.headers["set-cookie"].filter((item) => item.includes("gt="));
  return cookies.length > 0 ? cookies[0].split(";")[0].split("=")[1] : null;
};

const getProfile = async (guestToken, username) => {
  if (!guestToken) {
    guestToken = await getGuestToken();

    if (!guestToken) {
      console.error("Cannot get the guest token!");
      return;
    }
  }

  try {
    const params = {
      variables: JSON.stringify({ screen_name: username, withSafetyModeUserFields: true }),
      features: JSON.stringify({
        blue_business_profile_image_shape_enabled: false,
        responsive_web_graphql_exclude_directive_enabled: true,
        verified_phone_label_enabled: false,
        responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
        responsive_web_graphql_timeline_navigation_enabled: true,
      }),
    };

    const response = await axios.get("https://twitter.com/i/api/graphql/k26ASEiniqy4eXMdknTSoQ/UserByScreenName", {
      params,
      headers: {
        "User-Agent": USER_AGENT,
        Authorization: `Bearer ${BEARER_TOKEN}`,
        "x-guest-token": guestToken,
      },
      httpsAgent: new https.Agent({
        minVersion: "TLSv1.3",
      }),
    });

    const { favourites_count, followers_count, friends_count, statuses_count, name, screen_name, verified, description, created_at, protected } = response.data.data.user.result.legacy;

    return {
      username: screen_name,
      name: name,
      description: description,
      likes: favourites_count,
      followers: followers_count,
      following: friends_count,
      tweets: statuses_count,
      verified: verified,
      joined: moment(created_at, "ddd MMM DD HH:mm:ss Z YYYY").toDate(),
      protected: protected ? true : false,
    };
  } catch (error) {
    console.log(error.response.data.errors);
  }
};

const getTweets = async (guestToken, username, since, until) => {
  if (!guestToken) {
    guestToken = await getGuestToken();

    if (!guestToken) {
      console.error("Cannot get the guest token!");
      return;
    }
  }

  let tweets = [];
  let cursor = null;
  let next_cursor = null;

  const params = {
    q: `(from:${username}) include:nativeretweets until:${until} since:${since}`,
    count: 20,
    include_reply_count: 20,
    tweet_mode: "extended",
    tweet_search_mode: "live",
    query_source: "typed_query",
  };

  const headers = {
    "User-Agent": USER_AGENT,
    Authorization: `Bearer ${BEARER_TOKEN}`,
    "x-guest-token": guestToken,
  };

  const httpsAgent = new https.Agent({
    minVersion: "TLSv1.3",
  });

  let page_number = 1;
  do {
    cursor = next_cursor;

    if (cursor !== null) {
      params.cursor = cursor;
    }

    try {
      const response = await axios.get("https://twitter.com/i/api/2/search/adaptive.json", {
        params,
        headers,
        httpsAgent,
      });

      tweets = tweets.concat(
        Object.values(response.data.globalObjects.tweets).map((item) => {
          return { id: item.id, text: item.full_text };
        })
      );

      if (response.data.timeline.instructions.length === 1) {
        const elements = response.data.timeline.instructions[0].addEntries.entries.filter((item) => item?.content?.operation?.cursor?.cursorType === "Bottom");
        next_cursor = elements[0].content.operation.cursor.value;
      } else {
        const elements = response.data.timeline.instructions.filter((item) => item?.replaceEntry?.entry?.content?.operation?.cursor?.cursorType === "Bottom");
        next_cursor = elements[0].replaceEntry.entry.content.operation.cursor.value;
      }

      console.log(`\tPage - ${page_number}: ${cursor !== null ? cursor : "Init"}`);
      page_number++;
    } catch (error) {
      // Too Many Requests
      if (error.response?.status === 429) {
        console.log(`429 Too Many Requests...`);
      } else {
        console.error(error);
      }
      break;
    }
  } while (cursor !== next_cursor);

  return tweets;
};

const main = async () => {
  const guestToken = await getGuestToken();
  const username = "ztancankiri";

  const profile = await getProfile(guestToken, username);
  console.log("Profile: " + JSON.stringify(profile, null, 4));

  const date_ranges = getMonthsBetweenGivenDates(profile.joined);
  date_ranges.reverse();

  let tweets = [];

  for (const range of date_ranges) {
    console.log(`${tweets.length} tweets are retrieved...`);
    console.log(`Retrieving tweets from ${range.start_date} to ${range.end_date}...`);
    tweets = tweets.concat(await getTweets(undefined, username, range.start_date, range.end_date));
  }

  tweets.sort((item1, item2) => {
    return item2.id - item1.id;
  });

  console.log("# Tweets: " + tweets.length);
  fs.writeFileSync("tweets.json", JSON.stringify(tweets, null, "\t"));
};

main();
