function deleteGroup(groupId) {
    var groupName=HighlightsData[groupId].name;
    document.getElementById("newGroup").style.display = "none";
    document.getElementById("deleteGroupName").innerHTML = groupName;
    document.getElementById("deleteGroupId").value = groupId;
    document.getElementById("wordDisplay").style.display = "none";
    document.getElementById("menu").style.display = "none";
    document.getElementById("deleteGroup").style.display = "block";
}

function yesDeleteGroup() {
    var groupId = document.getElementById("deleteGroupId").value;
    var groupObject=HighlightsData[groupId];
    Debug && console.log("yes delete group");
    if(groupObject.storage=='local') {
        chrome.storage.local.remove([groupId],function(){
            notify.listDeleted(groupObject.name);
            getLists(function(){drawInterface();});
            closeGroupForm();
            clearHighlightsFromTab();
        });
    }
    else if (groupObject.storage=='sync') {
        chrome.storage.sync.remove([groupId],function(){
            notify.listDeleted(groupObject.name);
            getLists(function(){drawInterface();});
            closeGroupForm();
            clearHighlightsFromTab();
        });
    }

    document.getElementById("wordDisplay").style.display = "block";
    document.getElementById("menu").style.display = "block  ";
    document.getElementById("deleteGroup").style.display = "none";
}

function noDeleteGroup() {
    document.getElementById("wordDisplay").style.display = "block";
    document.getElementById("menu").style.display = "block  ";
    document.getElementById("deleteGroup").style.display = "none";
}
function addGroup() {
    //backToFirstScreen();
    //document.getElementById("deleteButton").style.display = "none";
    document.getElementById("wordDisplay").style.display = "none";
    document.getElementById("menu").style.display = "none";
    document.getElementById("newGroup").style.display = "none";
    document.getElementById("newGroupType").style.display = "block";
    document.getElementById('wordsSection').style.display='block';
    document.getElementById('findWordsSection').style.display='block';

    
    document.getElementById('googleSheetsAssistant').style.display='none';

    document.getElementById("createGroupLink").disabled=true;
    document.getElementById("storageLocal").checked=false;
    document.getElementById("storageSync").checked=false;
    document.getElementById("newGroupTypePart2").style.display="none";
}

function createGroup() {
    document.getElementById("groupForm").reset();
    wordsToEditor();
    enableDisableAdvancedStyle()
    var storageTypes= document.getElementsByName("storage");
    var storage;
    for(var i = 0; i < storageTypes.length; i++) {
        if(storageTypes[i].checked)
        storage = storageTypes[i].value;
    }
    document.getElementById("field_storage").value=storage;
    var listTypes = document.getElementsByName("type");
    var listType;

    for(var i = 0; i < listTypes.length; i++) {
        if(listTypes[i].checked)
            listType = listTypes[i].value;
    }
    document.getElementById("field_listType").value=listType;
    switch(listType){
        case "local":
            document.getElementById("words").contentEditable=true;
            document.getElementById("wordsDelete").style.display="inline-flex";

            document.getElementById("regexSection").style.display="none";
            document.getElementById("words").className="";
            document.getElementById("extSource").style.display = "none";
            document.getElementById("syncFrequencySetting").style.display = "none";
            document.getElementById("wordsSection").style.display="block";

            

            break;
        case "remote":
            document.getElementById("regexSection").style.display="none";
            document.getElementById("words").contentEditable=false;
            document.getElementById("words").className="disabledWords";
            document.getElementById("wordsDelete").style.display="none";

            document.getElementById("extSource").style.display = "block";
            document.getElementById("syncFrequencySetting").style.display = "block";

            document.getElementById("field_remoteType").value="web";
            document.getElementById("googleSheetsAttributes").style.display="none";
            document.getElementById("pastbinAttributes").style.display="none";
            document.getElementById("webAttributes").style.display="block";
            document.getElementById("wordsSection").style.display="none";

            break;
        case "regex":
            document.getElementById("regexSection").style.dispay="block";
            document.getElementById("extSource").style.display = "none";
            document.getElementById("syncFrequencySetting").style.display = "none";
            document.getElementById("wordSection").style.display="none";

            break;
    }

    drawColorSelector("groupColorSelector", "#FFFF66");
    drawColorSelector("groupFColorSelector", "", "fcolor");
    if(Settings.license.type!=='Free'){
        drawColorSelector("groupBoxSelector", "", "boxcolor");
    }
    else {
        document.getElementById("groupBoxSelector").innerHTML = getLiteral("premium_feature") 
    }
   

    document.getElementById('bold').checked=false;
    renderBoldCheckbox();
    document.getElementById('italic').checked=false;
    renderItalicCheckbox();
    document.getElementById('underline').checked=false;
    renderUnderlineCheckbox();
    document.getElementById('border').checked=true;
    renderBorderCheckbox();
    document.getElementById('radius').checked=true;
    renderRadiusCheckbox();
    document.getElementById('padding').checked=true;
    renderPaddingCheckbox();


    document.getElementById("syncLink").style.display="none";
    document.getElementById("last_synced_on").style.display="none";
    document.getElementById("syncStatusLastUpdated").style.display="none";

    

    document.getElementById("syncStatusMessage").style.display="none";


    document.getElementById("example").style.backgroundColor = "#FFFF66";
    document.getElementById("example").style.color = "#000000";
    document.getElementById("groupFormTitle").innerHTML = getLiteral("popup_createWordList");
    document.getElementById("formSubmitButton").innerHTML = getLiteral("popup_add");
    document.getElementById("editWordsGroupId").value = "";
    document.getElementById("showInEditableFields").checked = false;
    document.getElementById("notifyOnHighlight").checked = false;
    document.getElementById("caseSensitive").checked = false;

    document.getElementById("regexTokens").checked = false;
    document.getElementById("field_words_help").innerHTML = getLiteral("field_words_help");

    document.getElementById("notifyFrequency").value = "1";
    document.getElementById('actionExample').style.display="none";

    document.getElementById("action").value="0";
    displayActionOptions("0");


    hintNonUnicodeChar("");

    backToFirstScreen();
    //document.getElementById("deleteButton").style.display = "none";
    document.getElementById("wordDisplay").style.display = "none";
    document.getElementById("newGroupType").style.display = "none";
    document.getElementById("menu").style.display = "none";
    document.getElementById("newGroup").style.display = "block";
}

function closeGroupForm() {
    document.getElementById("editWordsGroupId").value = "";
    document.getElementById("wordDisplay").style.display = "block";

    document.getElementById("menu").style.display = "block  ";

    document.getElementById("newGroup").style.display = "none";
    document.getElementById("newGroupType").style.display = "none";
}

function editGroup(groupId) {
    var wordsText = '';
    enableDisableAdvancedStyle()
    document.getElementById("highlightOnSites").value = HighlightsData[groupId].showOn ? HighlightsData[groupId].showOn.join("\n") : "";
    document.getElementById("dontHighlightOnSites").value = HighlightsData[groupId].dontShowOn ? HighlightsData[groupId].dontShowOn.join("\n") : "";

    document.getElementById('containerSelector').value=HighlightsData[groupId].containerSelector;
    drawColorSelector("groupColorSelector", HighlightsData[groupId].color);
    drawColorSelector("groupFColorSelector", HighlightsData[groupId].fColor, "fcolor");
    if(Settings.license.type!=='Free'){
        drawColorSelector("groupBoxSelector", HighlightsData[groupId].boxColor, "boxcolor");
    }    
    else{
        document.getElementById("groupBoxSelector").innerHTML = getLiteral("premium_feature") 
    }

    if(HighlightsData[groupId].words){
        wordsText=HighlightsData[groupId].words.join("\n");
    }
    else {
        wordsText='';
    }

    document.getElementById("example").style.backgroundColor = HighlightsData[groupId].color;
    document.getElementById("example").style.color = HighlightsData[groupId].fColor || '#000000';
    document.getElementById("formSubmitButton").innerHTML = getLiteral("popup_save");
    document.getElementById("group").value = HighlightsData[groupId].name;
    document.getElementById("editWordsGroupId").value = groupId;
    document.getElementById("groupFormTitle").innerHTML = getLiteral("popup_editWordlist") + " " + HighlightsData[groupId].name;
    document.getElementById('googleSheetsAssistant').style.display='none';



    document.getElementById("field_storage").value= HighlightsData[groupId].storage;
    switchTab(document.getElementById("tabGeneral"), "firstScreen","general");
   
    //displayMigrateStorage(groupId);

    //external lists
    document.getElementById("field_listType").value= HighlightsData[groupId].type;

    switch(HighlightsData[groupId].type){
        case "remote":
            document.getElementById("regexSection").style.display="none";
            document.getElementById("wordsSection").style.display="block";
            document.getElementById("findWordsSection").style.display="block";

            
            document.getElementById("words").contentEditable=false;
            document.getElementById("words").className="disabledWords";
            document.getElementById("wordsDelete").style.display="none";
            document.getElementById("syncLink").style.display="inline";
            document.getElementById("last_synced_on").style.display="initial";
            document.getElementById("syncStatusLastUpdated").style.display="initial";

            var lastSync=new Date(HighlightsData[groupId].remoteConfig.lastUpdated);
            document.getElementById("syncStatusLastUpdated").innerText=lastSync.toLocaleString(); 
            document.getElementById("extSource").style.display = "block";
                document.getElementById("syncRow").style.display="table-row";

            document.getElementById("syncFrequencySetting").style.display = "block";
            document.getElementById("field_remoteType").value=HighlightsData[groupId].remoteConfig.type;
            switch(HighlightsData[groupId].remoteConfig.type){
                case 'pastebin':
                    document.getElementById("pastebinId").value=HighlightsData[groupId].remoteConfig.id;
                    document.getElementById("webAttributes").style.display="none";
                    document.getElementById("pastbinAttributes").style.display="block";
                    document.getElementById("googleSheetsAttributes").style.display="none";

                    
                    break;
                case 'web':
                    document.getElementById("remoteWebUrl").value=HighlightsData[groupId].remoteConfig.url;

                    document.getElementById("webAttributes").style.display="block";
                    document.getElementById("pastbinAttributes").style.display="none";
                    document.getElementById("googleSheetsAttributes").style.display="none";
    
                    break;
                case 'googleSheets':
                    document.getElementById("googleSheetsId").value=HighlightsData[groupId].remoteConfig.id;
                    document.getElementById("googleSheetsAttributes").style.display="none";
                    document.getElementById("googleSheetsIdContainer").style.display="block";
                         document.getElementById("googleSheetsAttributes").style.display="block";

                   
                    document.getElementById("webAttributes").style.display="none";

                    document.getElementById("pastbinAttributes").style.display="none";
                    break;
                default:
            }
                 document.getElementById('syncFrequency').value=HighlightsData[groupId].remoteConfig.syncFrequency;
                document.getElementById('syncFrequency').disabled=false;

          
            break;
        case "regex":
            document.getElementById("regexSection").style.dispay="table-row";
            document.getElementById("extSource").style.display = "none";
            document.getElementById("syncFrequencySetting").style.display = "none";
            document.getElementById("wordsSection").style.display="none";
            document.getElementById("regex").value=HighlightsData[groupId].regex;
            break;
        default:
            document.getElementById("wordsSection").style.display="block";
            document.getElementById("regexSection").style.display="none";
            document.getElementById("words").contentEditable=true;
            document.getElementById("words").className="";
            document.getElementById("wordsDelete").style.display="inline-flex";
            document.getElementById("syncLink").style.display="none";
            document.getElementById("extSource").style.display = "none";
            document.getElementById("syncFrequencySetting").style.display = "none";
    }
    
    backToFirstScreen();

    document.getElementById('bold').checked=HighlightsData[groupId].bold;
    renderBoldCheckbox();
    document.getElementById('italic').checked=HighlightsData[groupId].italic;
    renderItalicCheckbox();
    document.getElementById('underline').checked=HighlightsData[groupId].underline;
    renderUnderlineCheckbox();
    document.getElementById('border').checked=HighlightsData[groupId].border;
    renderBorderCheckbox();
    document.getElementById('radius').checked=HighlightsData[groupId].radius;
    renderRadiusCheckbox();
    document.getElementById('padding').checked=HighlightsData[groupId].padding;
    renderPaddingCheckbox();

    document.getElementById("findwords").checked = HighlightsData[groupId].findWords;
    document.getElementById("showInEditableFields").checked = HighlightsData[groupId].showInEditableFields;
    document.getElementById("notifyOnHighlight").checked = HighlightsData[groupId].notifyOnHighlight;
    document.getElementById("notifyFrequency").value = HighlightsData[groupId].notifyFrequency;
    document.getElementById("regexTokens").checked = HighlightsData[groupId].regexTokens;
    document.getElementById("caseSensitive").checked = HighlightsData[groupId].caseSensitive;

    if(HighlightsData[groupId].action) {displayActionOptions(HighlightsData[groupId].action.type);}

    if(HighlightsData[groupId].regexTokens){
        document.getElementById("field_words_help").innerHTML = '<span class="regexmode">'+getLiteral("regex_mode")+'</span>' + getLiteral("field_words_regex_help");
    }
    else{
        document.getElementById("field_words_help").innerHTML = getLiteral("field_words_help");
    }

    if(HighlightsData[groupId].action){
        document.getElementById("action").value=HighlightsData[groupId].action.type;
        if (['1', '2', '3'].includes(HighlightsData[groupId].action.type)) {
            document.getElementById("actionLink").value=HighlightsData[groupId].action.actionLink;
            actionURLValidation(HighlightsData[groupId].action.actionLink);
        }
    }

    wordsToEditor(HighlightsData[groupId].words);
    hintNonUnicodeChar(wordsText);
    document.getElementById("wordDisplay").style.display = "none";
    document.getElementById("menu").style.display = "none";
    document.getElementById("syncStatusMessage").style.display="none";
    document.getElementById("syncLink").disabled=false;

    document.getElementById("newGroup").style.display = "block";
}

function getRemoteConfig(){
    remoteType=document.getElementById("field_remoteType").value;
    switch(remoteType){
        case 'pastebin':
            remoteConfig={'type':'pastebin', 'id':document.getElementById("pastebinId").value};
            break;
        case 'googleSheets':
            remoteConfig={'type':'googleSheets', 'id':document.getElementById("googleSheetsId").value};
            break;
        case 'web':
            remoteConfig={'type':'web', 'url':document.getElementById("remoteWebUrl").value};
            break;
        default:
    }
    remoteConfig.syncFrequency=document.getElementById('syncFrequency').value;
    return remoteConfig;
}

function formToObject(){

    var groupObject = {
        name: document.getElementById("group").value
    }

    if(document.getElementById("color").value==''){
        var color='';
    }
    else {
        var color = document.getElementById("color").jscolor.toHEXString();
    }

    if(document.getElementById("fcolor").value==''){
        var fcolor='';
    }
    else {
        var fcolor = document.getElementById("fcolor").jscolor.toHEXString();
    }

    var boxColor='';

    if(Settings.license.type!=='Free'){
        if(document.getElementById("boxcolor").value!==''){
            var boxColor = document.getElementById("boxcolor").jscolor.toHEXString();
        }
    }
    groupObject.color=color;
    groupObject.fColor=fcolor;
    groupObject.boxColor=boxColor;

    groupObject.bold=document.getElementById('bold').checked;
    groupObject.radius=document.getElementById('radius').checked;
    groupObject.padding=document.getElementById('padding').checked;
    groupObject.italic=document.getElementById('italic').checked;
    groupObject.underline=document.getElementById('underline').checked;
    groupObject.border=document.getElementById('border').checked;
    groupObject.findWords = document.getElementById("findwords").checked;
    groupObject.showInEditableFields = document.getElementById("showInEditableFields").checked;
    groupObject.notifyOnHighlight = document.getElementById("notifyOnHighlight").checked;
    groupObject.notifyFrequency = document.getElementById("notifyFrequency").value;
    groupObject.regexTokens= document.getElementById("regexTokens").checked ;
    groupObject.caseSensitive = document.getElementById("caseSensitive").checked;
    groupObject.storage=document.getElementById("field_storage").value;
    groupObject.type=document.getElementById("field_listType").value;
    
    groupObject.modified = Date.now();

    
    if (groupObject.type=='remote'){
        groupObject.remoteType=document.getElementById("field_remoteType").value;
        groupObject.remoteConfig=getRemoteConfig();
    }
    else {
        groupObject.remoteConfig={};
    }
    if (groupObject.type=='regex'){
        groupObject.regex=document.getElementById("regex").value;
    }
    else {
        groupObject.regex='';
    }

    /*document.getElementById("groupColorSelector").innerHTML = "";
    document.getElementById("groupBoxSelector").innerHTML = "";*/
    groupObject.words=editorToWords();

    highlightOnSites = document.getElementById("highlightOnSites").value.split("\n").filter(function (e) {
        return e
    });
    dontHighlightOnSites = document.getElementById("dontHighlightOnSites").value.split("\n").filter(function (e) {
        return e
    });

    containerSelector = document.getElementById("containerSelector").value.trim();

    var cleanHighLigthOnSites=[]; var cleanDontHighLigthOnSites=[];
    highlightOnSites.forEach(function(item) {
        cleanHighLigthOnSites.push( item.replace(/(http|https):\/\//gi, ""));
    });

    dontHighlightOnSites.forEach(function(item) {
        cleanDontHighLigthOnSites.push( item.replace(/(http|https):\/\//gi, ""));
    });

    groupObject.showOn= cleanHighLigthOnSites;
    groupObject.dontShowOn= cleanDontHighLigthOnSites;
    groupObject.containerSelector=containerSelector;
    groupObject.enabled= true;
    var action={};
    if(document.getElementById("action")!=0){
        action.type= document.getElementById("action").value;
        action.actionLink=document.getElementById("actionLink").value;
    }
    groupObject.action=action;

    return groupObject;
}

function submitGroup() {
    var groupId = document.getElementById("editWordsGroupId").value;

    if (groupId=='') {
        groupId=uuidv4();
    }

    var groupObject=formToObject();
    var storageObject=chrome.storage[groupObject.storage];
    storageObject.set({[groupId]:groupObject},function(){
        if (chrome.runtime.lastError) {
            console.log("Runtime error.");
            notify.listNotSaved(groupObject.name, chrome.runtime.lastError.message);
            return;
        }
        if(groupObject.type=='remote'){
            chrome.runtime.sendMessage({command: "syncList",groupId:  groupId,remoteConfig:  groupObject.remoteConfig, save: true}, function (response) {
                getLists(function(){drawInterface();});
            })
        }
        else {
            getLists(function(){drawInterface();});
        }
        notify.listSaved(groupObject.name);
        
        closeGroupForm();
        clearHighlightsFromTab();
    });
    
}

function flipGroup(groupId, inAction) {
    Debug && console.info("Flip group : ", groupId, inAction);
    groupObject=HighlightsData[groupId];
    groupObject.enabled= (inAction=='disable')?false:true;
    
    if(groupObject.storage=='local') {
        chrome.storage.local.set({[groupId]:groupObject},function(){
            groupObject.enabled?notify.listEnabled(groupObject.name):notify.listDisabled(groupObject.name);
            getLists(function(){drawInterface();});
            closeGroupForm();
            clearHighlightsFromTab();
        });
    }
    else if (groupObject.storage=='sync') {
        chrome.storage.sync.set({[groupId]:groupObject},function(){
            groupObject.enabled?notify.listEnabled(groupObject.name):notify.listDisabled(groupObject.name);
            getLists(function(){drawInterface();});
            closeGroupForm();
            clearHighlightsFromTab();
        });
    }
}

function migrateStorage(){
    var groupId= document.getElementById("editWordsGroupId").value;
    groupObject=HighlightsData[groupId];

    //create a new group in the other storage area with a new id and remove the current group
    if (groupObject.storage=='local'){
        groupObject.storage='sync';
        chrome.storage.sync.set({[uuidv4()]:groupObject},function(){
            chrome.storage.local.remove(groupId,function(){
                getLists(function(){drawInterface();});
                closeGroupForm();
                clearHighlightsFromTab();
            });
        });
    }   
    else if (groupObject.storage=='sync'){
        groupObject.storage='local';
        chrome.storage.local.set({[uuidv4()]:groupObject},function(){
            chrome.storage.sync.remove(groupId,function(){
                getLists(function(){drawInterface();});
                closeGroupForm();
                clearHighlightsFromTab();
            });
        });
    }
    
}

function moveWords(words, fromGroupId, toGroupId){
    //moves words from 1 group to another one


    getLists(function() {
        var toGroup=HighlightsData[toGroupId];
        var wordsAdded=[];
        var wordsAlreadyAdded=[];
        for(var word in words){

            if (toGroup.words.indexOf(words[word])>-1) {
                wordsAlreadyAdded.push(words[word]);
            }
    
            else {
                toGroup.words.push(words[word]);
                toGroup.modified = Date.now();
                wordsAdded.push(words[word]);
            }
        }
        if(wordsAdded.length>0){
            if(toGroup.storage=='local') {
                chrome.storage.local.set({[toGroupId]:toGroup},function(){
                    HighlightsData[toGroupId]=toGroup;
                });
            }
            else if (groupObject.storage=='sync') {
                chrome.storage.sync.set({[toGroupId]:toGroup},function(){
                    HighlightsData[toGroupId]=toGroup;
                });
            }
        }
    });

}

function storageSelected(){
    var storageTypes= document.getElementsByName("storage");
    var storage;
    for(var i = 0; i < storageTypes.length; i++) {
        if(storageTypes[i].checked)
        storage = storageTypes[i].value;
    }
    if(storage=='local'){
        document.getElementById("newGroupTypePart2").style.display="block";
    }
    else {
        document.getElementById("newGroupTypePart2").style.display="none";
        document.getElementById("typeLocal").checked=true;
        document.getElementById("typeRemote").checked=false;
        
    }
    document.getElementById("createGroupLink").disabled=false;
}