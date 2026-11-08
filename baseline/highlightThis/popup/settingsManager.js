function getSettingsFromStorage() {
    return new Promise((resolve, reject) => {
        chrome.storage.local.get(['Settings'], (result) => {
        if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
        } else {
            resolve(result);
        }
        });
    });
}

async function getSettings() {
    try {
        const localData = await getSettingsFromStorage();
        return localData.Settings;
    } catch (error) {
        console.error(error);
        return false;
    }
}

// retrieve the settings
async function retrieveSettings() {
    Settings = await getSettings();
}

function setSetting(setting, value, callback){
    switch(setting) {
        case 'enabled':
            Settings.enabled = value;
            value?notify.highlightingEnabled():notify.highlightingDisabled();
            break;
        case 'showFoundWords':
            Settings.showFoundWords = value;
            break;
        case 'printHighlights':
            Settings.printHighlights = value;
            break;
        case 'licenseFree':
            Settings.license={type:'Free'};
            notify.licenseChangedFree();
            chrome.runtime.sendMessage({command: "sendAnalyticsOnSubChange"}, function (response) {});
            break;
        case 'licenseAd':
            Settings.license={type:'Ad'};
            notify.licenseChangedAd();
            chrome.runtime.sendMessage({command: "sendAnalyticsOnSubChange"}, function (response) {});
            break;
        case 'magicHighlighting':
            Settings.magicHighlighting = value;
            break;
        case 'order':
            Settings.order = value;
            break;
    }
    chrome.storage.local.set({['Settings']:Settings},callback);
}

function saveSettings(){

    Settings.showFoundWords = document.getElementById("showFoundWords").checked;
    Settings.printHighlights = document.getElementById("printHighlights").checked;
    Settings.magicHighlighting = document.getElementById("magicHighlighting").checked;
    Settings.rangeHighlighting = document.getElementById("rangeHighlighting").checked;

    Settings.neverHighlightOn = normalizeSiteRestrictions(document.getElementById("neverHighlightOn").value);
    Settings.onlyHighlightOn = normalizeSiteRestrictions(document.getElementById("onlyHighlightOn").value);

    Settings.performanceSetting = document.getElementById("performance").value*100+100;
    

    //backup
    if(!Settings.backup || (Settings.backup&&Settings.backup.frequency!==document.getElementById("autoBackupFrequency").value)) {
        if(document.getElementById("autoBackupFrequency").value=='never'){
            delete Settings.backup;
        }
        else {
            Settings.backup={
                frequency: document.getElementById("autoBackupFrequency").value,
                last: null
            }
        }
    }

    chrome.storage.local.set({['Settings']:Settings},function(){
        notify.settingsSaved();
        closeSettings();
    });
}


function getLicense(key, callback){
    const licenseUrl='https://api.highlightthis.net/api/licenseService/licensecheck';
    requestObject={
        licenseKey: key,
        installId: Settings.installId
    }
    fetch(licenseUrl
    , {
        method: "POST", // or 'PUT'
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestObject)
    }).then((response)=>{
        if (response.ok) {
            return response.text();
        }   
        throw new Error('Network response was not ok.');         
        callback(false)
    }).then((licenseInfo)=>{
        licenseInfo=JSON.parse(licenseInfo);
        //console.log(licenseInfo);
        validUntil=new Date(licenseInfo.validUntil).getTime();

        Settings.license={type: licenseInfo.product, validUntil:validUntil, licenseKey: licenseInfo.licenseKey}
        notify.licenseChangedPaid(licenseInfo.product, licenseInfo.validUntil);
        chrome.storage.local.set({['Settings']:Settings},callback(true));
        chrome.runtime.sendMessage({command: "sendAnalyticsOnSubChange"}, function (response) {});

    })
    .catch((err)=>{
        console.log(err);
        callback(false)
    });
}

function resetDataAndSettings() {

    document.getElementById("newGroup").style.display = "none";
    document.getElementById("wordDisplay").style.display = "none";
    document.getElementById("menu").style.display = "none";
    document.getElementById("deleteGroup").style.display = "none";
    document.getElementById("settingsGroup").style.display = "none";
    document.getElementById("resetSettings").style.display = "block";
    
}

function noResetDataAndSettings(){
    document.getElementById("settingsGroup").style.display = "block";
    document.getElementById("resetSettings").style.display = "none";
    
}

function yesResetDataAndSettings(){
    chrome.runtime.sendMessage({command: "resetDataAndSettings"}, function (response) {
        window.close();
    });

    
}