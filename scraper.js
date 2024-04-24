const cheerio = require("cheerio");
const axios = require("axios");
const Telenode = require("telenode-js");
const fs = require("fs");
const config = require("./config.json");

const getYad2Response = async (url) => {
  const requestOptions = {
    method: "GET",
    redirect: "follow",
  };
  try {
    const res = await fetch(url, requestOptions);
    return await res.text();
  } catch (err) {
    console.log(err);
  }
};

const scrapeItemsAndExtract = async (url) => {
  const yad2Html = await getYad2Response(url);
  if (!yad2Html) {
    throw new Error("Could not get Yad2 response");
  }
  const $ = cheerio.load(yad2Html);
  const $feedItems = $(".feed-item-base_itemMainContent__WFXEZ"); // Selecting elements with the specified class
  const htmlContents = [];

  for (let i = 0; i < $feedItems.length; i++) {
    const parent = $($feedItems[i]).parent(); // Get the parent element
    const href = parent.attr("href"); // Get the href attribute
    console.log("herf - " + href);
    if (href) {
      try {
        const response = await axios.get(href); // Fetch the HTML content from the URL
        console.log("response - " + response.data);

        htmlContents.push(response.data); // Push the HTML content to the array
      } catch (error) {
        console.error(`Error fetching HTML content from ${href}:`, error);
      }
    }
  }

  return htmlContents;
};

const scrapeItemsAndExtractImgUrls = async (url) => {
  const yad2Html = await getYad2Response(url);
  console.log("yad2 html - " + yad2Html);
  if (!yad2Html) {
    throw new Error("Could not get Yad2 response");
  }
  const $ = cheerio.load(yad2Html);
  const title = $("title");
  const titleText = title.first().text();
  if (titleText === "ShieldSquare Captcha") {
    throw new Error("Bot detection");
  }
  const $feedItems = $("img.feed-item-base_image__QKeIo");
  console.log("Items - " + $feedItems);
  if (!$feedItems) {
    throw new Error("Could not find feed items");
  }
  const imageUrls = [];
  $feedItems.each((_, elm) => {
    const imgSrc = $(elm).attr("src");
    if (imgSrc) {
      imageUrls.push(imgSrc);
    }
  });
  return imageUrls;
};

const checkIfHasNewItem = async (imgUrls, topic) => {
  const filePath = `./data/${topic}.json`;
  let savedUrls = [];
  try {
    savedUrls = require(filePath);
  } catch (e) {
    if (e.code === "MODULE_NOT_FOUND") {
      fs.mkdirSync("data");
      fs.writeFileSync(filePath, "[]");
    } else {
      console.log(e);
      throw new Error(`Could not read / create ${filePath}`);
    }
  }

  let shouldUpdateFile = false;
  const newItems = [];

  for (const url of imgUrls) {
    if (!savedUrls.includes(url)) {
      savedUrls.push(url);
      newItems.push(url);
      shouldUpdateFile = true;
    }
  }

  if (shouldUpdateFile) {
    const updatedUrls = JSON.stringify(savedUrls, null, 2);
    fs.writeFileSync(filePath, updatedUrls);
    await createPushFlagForWorkflow();
  }

  return newItems;
};

const createPushFlagForWorkflow = () => {
  fs.writeFileSync("push_me", "");
};

const scrape = async (topic, url) => {
  const apiToken = process.env.API_TOKEN || config.telegramApiToken;
  const chatId = process.env.CHAT_ID || config.chatId;
  const telenode = new Telenode({ apiToken });
  try {
    await telenode.sendTextMessage(
      `Starting scanning ${topic} on link:\n${url}`,
      chatId
    );
    const scrapeImgResults = await scrapeItemsAndExtract(url);
    console.log("just finished scrapeItemsAndExtract");
    const newItems = await checkIfHasNewItem(scrapeImgResults, topic);
    console.log("just finished checkIfHasNewItem");

    if (newItems.length > 0) {
      const newItemsJoined = newItems.join("\n----------\n");
      const msg = `${newItems.length} new items:\n${newItemsJoined}`;
      await telenode.sendTextMessage(msg, chatId);
    } else {
      await telenode.sendTextMessage("No new items were added", chatId);
    }
  } catch (e) {
    let errMsg = e?.message || "";
    if (errMsg) {
      errMsg = `Error: ${errMsg}`;
    }
    await telenode.sendTextMessage(
      `Scan workflow failed... 😥\n${errMsg}`,
      chatId
    );
    throw new Error(e);
  }
};

const program = async () => {
  await Promise.all(
    config.projects
      .filter((project) => {
        if (project.disabled) {
          console.log(`Topic "${project.topic}" is disabled. Skipping.`);
        }
        return !project.disabled;
      })
      .map(async (project) => {
        await scrape(project.topic, project.url);
      })
  );
};

program();
