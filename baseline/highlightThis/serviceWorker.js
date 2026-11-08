console.info('Start HighlightThis serviceworker')
const debug=false;
import {createContextMenu, updateContextMenu} from './serviceWorker/contextMenu.js'
import {sendAnalytics} from './serviceWorker/analytics.js'
import * as utilities from './serviceWorker/utilities.js' 
import {setInitialData,addWordToList,showHighlights,upgradeDataFromPreV3,syncWordList, syncData,resetAll,detectAndRepairSync, exportToFile} from './serviceWorker/highlightData.js';
import {licenseCheck, getAdConfig} from './serviceWorker/licenseManager.js';
import * as notifications from './serviceWorker/notifications.js';


function messageListener() {
    
    debug&&console.info('Starting message listener')

    chrome.runtime.onMessage.addListener(
        function(request, sender, sendResponse) {
            
            debug && console.info("Message received", request, sender);

            if(request.command=='SyncAll'){
                syncData();
                return true;
            }
            if(request.command=="syncList") {
                var syncResponse= syncWordList(request.groupId, true, request.save, request.remoteConfig, function(response){
                    sendResponse(response);
                })
                return true;
            }
           
            if(request.command=='detectAndRepairSync'){
                detectAndRepairSync();
                return false;
            }
            if(request.command=='upgradeFromPreV3'){
                var upgradedData=upgradeDataFromPreV3(request.data, request.type);
                sendResponse({upgraded:upgradedData});
                return false;
            }

            if(request.command=='resetDataAndSettings'){
                resetAll();
                sendResponse({});
                return true;
            }

            if(request.command=='openUrlInNewWindow'){
                chrome.windows.create({url:request.url})
                return true;
            }

            if(request.command=="showHighlights") {
                showHighlights(request.count ,sender.tab.id, request.url);
                sendResponse({success: 'ok'});
                return false;
            }
           
        
            if(request.command=="updateContextMenu"){
                updateContextMenu(request.url, request.groups);
                sendResponse({success: 'ok'});
                return false;
            }
            
            if(request.command=="notifyOnHighlight"){       
                notifications.notifyWordFoundOnPage(sender.tab.title);
                sendResponse({success: 'ok'});
                return false;
            }
            
            if(request.command=="sendAnalyticsOnSubChange"){       
                sendAnalytics('subChange');
                sendResponse({success: 'ok'});
                return false;
            }
            sendAnalytics
            return true;
        }
    ) 
}


function menuListener() {
    debug&&console.info('Starting menu listener')
    chrome.contextMenus.onClicked.addListener(function (info, tab) {
        if (info.menuItemId.indexOf("AddTo_") ==0) {
            var groupId = info.menuItemId.replace("AddTo_", "");
            addWordToList(groupId,info.selectionText, function(){
                chrome.tabs.sendMessage(tab.id, {command: "reHighlight"})
            });

        }
        if (info.menuItemId == "Highlight") {
            chrome.tabs.query({active: true, currentWindow: true}, function (tabs) {
                chrome.tabs.sendMessage(tabs[0].id, {command: "ScrollHighlight"});
            });
        }
        if (info.menuItemId == "Manage") {
            chrome.windows.create(
                {
                    url: "popup.html?url="+tab.url,

                    type: 'normal'
                }
              )
        }
    })
}

chrome.commands.onCommand.addListener(function(command) {
    if (command=="ScrollHighlight") {
      chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
          chrome.tabs.sendMessage(tabs[0].id, {command: "ScrollHighlight"});
      });
    }
  });

function parseVersion(version) {
    return version.split('.').map(Number);
}

function isMajorUpgrade(prevVersion, currVersion) {
    const [prevMajor] = parseVersion(prevVersion);
    const [currMajor] = parseVersion(currVersion);

    return currMajor > prevMajor;
}

function isMinorUpgrade(prevVersion, currVersion) {
    const [prevMajor, prevMinor] = parseVersion(prevVersion);
    const [currMajor, currMinor] = parseVersion(currVersion);

    return currMajor === prevMajor && currMinor > prevMinor;
}



  
// Record the notice inside Settings so it cannot be mistaken for a word list.
function queueRangeHighlightingNotice(details) {
    if (details.reason !== 'update') return;
    const version = chrome.runtime.getManifest().version;
    if (version !== '6.3.14' || details.previousVersion === version) return;
    chrome.storage.local.get(['Settings'], function (data) {
        const settings = data.Settings;
        if (!settings || settings.rangeHighlighting === true ||
            settings.rangeHighlightingNotice?.version === version) return;
        settings.rangeHighlightingNotice = { version, pending: true };
        chrome.storage.local.set({ Settings: settings }, function () {
            if (chrome.runtime.lastError) return;
            chrome.tabs.create({ url: chrome.runtime.getURL('modern-highlighting.html'), active: true });
        });
    });
}

chrome.runtime.onInstalled.addListener(function(details){
    queueRangeHighlightingNotice(details);
    debug&&console.info('Event on installed received', details);
    
    chrome.alarms.create("Data sync", {"periodInMinutes":10});
    chrome.alarms.create("LicenseCheck", {"periodInMinutes":360});
    chrome.alarms.create("AdConfig", {"periodInMinutes":60});
    chrome.alarms.create("Backup", {"periodInMinutes":1});
    chrome.alarms.create("sendAnalytics", {"periodInMinutes":14400});

    chrome.storage.session.setAccessLevel({accessLevel:'TRUSTED_AND_UNTRUSTED_CONTEXTS'}, function(){});
    if(details.reason == "install"){
        debug&&console.info('This is a first install');
        var creating = chrome.tabs.create({
            url:"https://highlightthis.net/Welcome.html"
        });
        setTimeout(function(){ sendAnalytics('install'); }, 10000);
        setInitialData();
        

    }else if(details.reason == "update"){
        var thisVersion = chrome.runtime.getManifest().version;
        debug&&console.log("Updated from " + details.previousVersion + " to " + thisVersion + "!");
        setTimeout(function(){ sendAnalytics('update'); }, 10000);
        if (details.previousVersion.substr(0,1)!=='6') {
            var migrationPage = chrome.tabs.create({
                url:"v3migration.html?action=execute"
            });
            var updatePage = chrome.tabs.create({
                url:"https://highlightthis.net/ReleaseNote_6.html"
            });
        }
        else {
            // check if there is a settings object, otherwise create it all
            chrome.storage.local.get(function(e){
                if(!e.Settings){
                    setInitialData();
                }
            })
            // check if it is a major upgrade, if so show the latest release notes
            if(isMajorUpgrade(details.previousVersion, thisVersion)||isMinorUpgrade(details.previousVersion, thisVersion)){
                var updatePage = chrome.tabs.create({
                    url:"https://highlightthis.net/ReleaseNote_6_3.html"
                });
            }
        }
    }
});


chrome.tabs.onActivated.addListener(function(tabid){
    chrome.tabs.query({active: true, currentWindow: true}, function (tabs) {
        debug && console.info("in tabs onactivated", tabid, tabs);
        if(tabs[0].url.indexOf('chrome://')==-1){
            try {
                chrome.tabs.sendMessage(tabs[0].id, {command: "tabActivated"}, function(){});
            }
            catch {

            }
        }
    });
});

chrome.alarms.onAlarm.addListener(function(alarm){
    if(alarm.name=="Data sync") {
        syncData();
    }
    if(alarm.name=='LicenseCheck'){
        licenseCheck();
    }
    if(alarm.name=='AdConfig'){
        getAdConfig();
    }
    if(alarm.name=='sendAnalytics'){
        sendAnalytics('timer');
    }
    if(alarm.name=='Backup'){
        exportToFile();
    }
})

chrome.storage.sync.onChanged.addListener(function(){
    debug && console.log('sync storage changed. check if there is maybe an old version');
    detectAndRepairSync();

});

chrome.tabs.onUpdated.addListener(function(tabid, changeInfo, tab){
    if(changeInfo.url){
        //console.log(tabid, changeInfo.url)
        chrome.tabs.sendMessage(tabid, {command: "urlChanged", url:changeInfo.url}, function(){});

    }
});


createContextMenu();
messageListener();
menuListener();
getAdConfig();
licenseCheck();
