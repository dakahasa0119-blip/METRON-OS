// User gesture only. No background polling, credential access or login automation.
chrome.action.onClicked.addListener(async tab => {
  if(!tab?.id||!/^https:\/\/chatgpt\.com\//.test(tab.url||""))return;
  await chrome.scripting.executeScript({
    target:{tabId:tab.id},files:["content.js"]
  });
});
