function registerEventListeners() {
    const debug=false;
    // JavaScript code for navigation menu with hamburger icon
const hamburgerMenu = document.getElementById('hamburger-menu');
const navLinks = document.querySelector('nav ul');


window.onclick = function(event) {
    if (!event.target.matches('ul.show')&&!event.target.closest('nav')&&document.querySelector('ul.show')) {
        navLinks.classList.toggle('show');
    }
  }
  hamburgerMenu.addEventListener('click', () => {
    navLinks.classList.toggle('show');
    hamburgerMenu.classList.toggle('open');
  });


  document.getElementById('sendErrorsIssue').addEventListener('change', function(){
    enableIssueSubmit();
  })  
  document.getElementById('sendErrorsEmail').addEventListener('change', function(){
    enableIssueSubmit();
  })
  
    function enableIssueSubmit(){
        enableButton=0;

        if (! /[\w-\.]+@([\w-]+\.)+[\w-]{2,4}/i.test(document.getElementById('sendErrorsEmail').value)) {
            document.getElementById('sendErrorsEmail').style.borderColor='red';
        }
        else {
            document.getElementById('sendErrorsEmail').style.borderColor='inherit';
            enableButton+=1;
        }
        
        if (document.getElementById('sendErrorsIssue').value.length<2) {
            document.getElementById('sendErrorsIssue').style.borderColor='red';
        }
        else{
            document.getElementById('sendErrorsIssue').style.borderColor='inherit';
            enableButton+=1;
        }
        
        document.getElementById('sendErrorsButton').disabled=(enableButton!=2);
       
    }

    document.getElementById('italic-state-button').addEventListener('click', function() {
        document.getElementById('italic').checked = !document.getElementById('italic').checked;
        renderItalicCheckbox()
    });


    document.getElementById('bold-state-button').addEventListener('click', function() {
        document.getElementById('bold').checked = !document.getElementById('bold').checked;
        renderBoldCheckbox()
    });

    document.getElementById('radius-state-button').addEventListener('click', function() {
        document.getElementById('radius').checked = !document.getElementById('radius').checked;
        renderRadiusCheckbox()
    });

    document.getElementById('underline-state-button').addEventListener('click', function() {
        document.getElementById('underline').checked = !document.getElementById('underline').checked;
        renderUnderlineCheckbox();
    });

    document.getElementById('padding-state-button').addEventListener('click', function() {
        document.getElementById('padding').checked = !document.getElementById('padding').checked;
        renderPaddingCheckbox();
    });


    document.getElementById('border-state-button').addEventListener('click', function() {
        document.getElementById('border').checked = !document.getElementById('border').checked;
        renderBorderCheckbox();
    });

    document.getElementById("exportLink").addEventListener('click', function () {
        exportToFile();
        return false;
    });
    document.getElementById("homeLink").addEventListener('click', function () {
        hamburgerMenu.classList.remove('open');
        navLinks.classList.remove('show');
        showHome();
        drawInterface();
    });

    document.getElementById("settingsLink").addEventListener('click', function () {
        hamburgerMenu.classList.remove('open');
        navLinks.classList.remove('show');

        showSettings();
    });

    document.getElementById("licenseLink").addEventListener('click', function () {
        hamburgerMenu.classList.remove('open');
        navLinks.classList.remove('show');

        showLicense();
    });

    document.getElementById("sendErrorsLink").addEventListener('click', function () {
        hamburgerMenu.classList.remove('open');
        navLinks.classList.remove('show');
        enableIssueSubmit();
        showBugReport();
    });
    

    document.getElementById("helpLink").addEventListener('click',function(){
        window.open("https://highlightthis.net/Help.html");
    });

    document.getElementById('importFile').addEventListener('change',function(){
        //document.getElementById('importFileLink').innerHTML = chrome.i18n.getMessage("field_import") + ' ' + document.getElementById('importFile').files[0].name;
        analyzeInputFile();
        //document.getElementById('importFileLink').style.display="block";
    })
    /*document.getElementById("backFromSettings").addEventListener('click', function () {
        document.getElementById("settingsGroup").style.display = "none";
        document.getElementById("wordDisplay").style.display = "block";
        document.getElementById("menu").style.display = "block  ";
        drawInterface();
        return false;
    });*/

    document.getElementById("cancelSettings").addEventListener('click', function () {
        closeSettings();
        return false;
    });
    document.getElementById("saveSettings").addEventListener('click', function (e) {
        e.preventDefault();
        saveSettings();
        return false;
    });
    document.getElementById("importFileLink").addEventListener('click', function () {
        startRead();
        return false;
    });

    //home page
    document.getElementById("collapseAll").addEventListener('click', function () {
        if (Collapsed){
            expandAll();
        }
        else {
            collapseAll();
        }

        return false;
    });

    document.getElementById("filterwords").addEventListener('input',function(){filterWords(this.value)});

    //words found page
    document.getElementById("dontshowwords").addEventListener('click', function () {
        setSetting('showFoundWords', false)
        showConfig();
        drawInterface();
        return false;
    });

    //word group page
    document.getElementById("cancelAddGroup").addEventListener('click', function () {
        closeGroupForm();
        drawInterface();
        return false;
    });

    document.getElementById("cancelCreateGroup").addEventListener('click', function () {
        closeGroupForm();
        return false;
    });

    document.getElementById("findwords").addEventListener('change', function () {
        hintNonUnicodeChar(editorToWords().join());
        return false;
    });


    document.getElementById("regexTokens").addEventListener('change',function(){
        if(document.getElementById("regexTokens").checked){
            document.getElementById("field_words_help").innerHTML = '<span class="regexmode">'+getLiteral("regex_mode")+'</span>' + getLiteral("field_words_regex_help");
            
        }
        else{
            document.getElementById("field_words_help").innerHTML = getLiteral("field_words_help");
        }
        validateWords();
    })

    document.getElementById("highlightOnSites").addEventListener('focusout',function(){

        lengthLimitSyncStorage();
    })
    document.getElementById("dontHighlightOnSites").addEventListener('focusout',function(){

        lengthLimitSyncStorage();
    })

    /*document.getElementById("browseHighlight").addEventListener('click', function () {
        browseHighlight();
        return false;
    });*/

    document.getElementById("toConfig").addEventListener('click', function () {
        showConfig();
        drawInterface();
        return false;
    });
    document.getElementById("groupForm").addEventListener('submit', function (e) {
        e.preventDefault();
        submitGroup();
        //return false;
    });

    document.getElementById("migrateSuggestionButton").addEventListener('click', function () {
        migrateStorage();
        return false;
    });

    document.getElementById("resetDataAndSettings").addEventListener('click', function () {
        resetDataAndSettings();
        return false;
    });
    
    document.getElementById("yesReset").addEventListener('click', function () {
        yesResetDataAndSettings();
        return false;
    });
    document.getElementById("noReset").addEventListener('click', function (e) {
        e.preventDefault();
        noResetDataAndSettings();
        return false;
    });

    document.getElementById("yesDeleteGroup").addEventListener('click', function () {
        yesDeleteGroup();
        return false;
    });
    document.getElementById("noDeleteGroup").addEventListener('click', function (e) {
        e.preventDefault();
        noDeleteGroup();
        return false;
    });
    /* document.getElementById("deleteGroupLink").addEventListener('click', function () {
        deleteGroup();
        return false;
    });*/
    document.getElementById("myonoffswitch").addEventListener('change', function () {
        onOff();
        return false;
    });
    document.getElementById("performance").addEventListener('change',function(ev){
        showPerformanceDescription(ev.currentTarget.value*100+100);
    })
    document.getElementById("addGroupLink").addEventListener('click', function () {
        addGroup();
        return false;
    });

    document.getElementById("tabSettingsGeneral").addEventListener('click', function (ev) {
        switchTab(ev.currentTarget, "settingsGeneral","settings");
        return false;
    });
    document.getElementById("tabSettingsBackup").addEventListener('click', function (ev) {
        switchTab(ev.currentTarget, "settingsBackup","settings");
        document.getElementById("exportLinkDownload").innerHTML="";
        return false;
    });
    
    document.getElementById("tabSettingsLimitations").addEventListener('click', function (ev) {
        switchTab(ev.currentTarget, "settingsLimitations","settings");
        return false;
    });

    document.getElementById("tabGeneral").addEventListener('click', function (ev) {
        switchTab(ev.currentTarget, "firstScreen","general");
        return false;
    });
    document.getElementById("tabStyleScreen").addEventListener('click', function (ev) {
        switchTab(ev.currentTarget, "styleScreen","general");
        return false;
    });

    document.getElementById("tabLimitations").addEventListener('click', function (ev) {
        switchTab(ev.currentTarget, "secondScreen","general");
        return false;
    });
    document.getElementById("tabAction").addEventListener('click', function (ev) {
        switchTab(ev.currentTarget, "actionScreen","general");
        return false;
    });

    document.getElementById("tabAdvanced").addEventListener('click', function (ev) {
        var groupId= document.getElementById("editWordsGroupId").value

        displayMigrateStorage(groupId);

        switchTab(ev.currentTarget, "thirdScreen","general");
        return false;
    });

    document.getElementById("syncLink").addEventListener('click', function (e) {
        e.preventDefault();
        syncList();
        return false;
    });
    document.getElementById("createGroupLink").addEventListener('click', function () {
        createGroup();
        return false;
    });

    document.getElementById("storageLocal").addEventListener('change',function(){
        storageSelected();
    });

    document.getElementById("storageSync").addEventListener('change',function(){
        storageSelected();
    });
    
    document.getElementById("field_remoteType").addEventListener('change',function(){

        document.getElementById("pastbinAttributes").style.display="none";
        document.getElementById("webAttributes").style.display="none";
        document.getElementById("googleSheetsAttributes").style.display="none";

        switch(document.getElementById("field_remoteType").value){
            case 'web':
                document.getElementById("webAttributes").style.display="block";

                break;
            case 'pastebin':
                document.getElementById("pastbinAttributes").style.display="block";
                break;
            case 'googleSheets':
            
                document.getElementById("googleSheetsAttributes").style.display="block";
            
                break;
        }

        //debug && console.log(document.getElementById("field_remoteType").value);
    })

    document.getElementById("remoteSourceAttributes").addEventListener("change",function(){
        // disable sync button on change of remote config

        //document.getElementById("syncLink").disabled=true;

    });

    document.getElementById('launchGoogleSheetsAssisantbtn').addEventListener('click', function(e){
        e.preventDefault();
        document.getElementById('wordsSection').style.display='none';
        document.getElementById('findWordsSection').style.display='none';
        document.getElementById('launchGoogleSheetsAssisantbtn').style.display="none";
        
        document.getElementById("syncRow").style.display="none";
        document.getElementById("googleSheetsIdContainer").style.display="none";

        

        document.getElementById('closeGoogleSheetsAssisantbtn').style.display="block";
        document.getElementById('googleSheetsAssistant').style.display='block';


    })

    document.getElementById('closeGoogleSheetsAssisantbtn').addEventListener('click', function(e){
        e.preventDefault();
        document.getElementById('wordsSection').style.display='block';
        document.getElementById('findWordsSection').style.display='block';
        document.getElementById('googleSheetsAssistant').style.display='none';

        document.getElementById("syncRow").style.display="table-row";
        
        document.getElementById("googleSheetsIdContainer").style.display="block";

        document.getElementById('launchGoogleSheetsAssisantbtn').style.display="block";
        document.getElementById('closeGoogleSheetsAssisantbtn').style.display="none";

    })

    document.getElementById('googleAssistOKbtn').addEventListener('click',function(e){
        e.preventDefault();
        var url=document.getElementById('googleAssistLink').value;
        var response=extractGoogleSheetsIdFromURL(url);
        if(response.result){
            document.getElementById('googleSheetsId').value=response.id;
            document.getElementById('googleAssistInfo').innerText="success";
        }
        else{
            document.getElementById('googleAssistInfo').innerText="error " + response.message;

        }
    })

    document.getElementById("licenseDisableAds").addEventListener('click', function(e){
        e.preventDefault();
        if(Settings.license.type!='Temp'||(Settings.license.type=='Temp'&&confirm(getLiteral('license_confirm_temp_remove')))){
            setSetting('licenseFree', true, function(){showLicense();});
        }
        

    });

    document.getElementById("licenseEnableAds").addEventListener('click', function(e){
        e.preventDefault();
        if(Settings.license.type!='Temp'||(Settings.license.type=='Temp'&&confirm(getLiteral('license_confirm_temp_remove')))){
            setSetting('licenseAd', true, function(){showLicense();});
        }
    });

    

    document.getElementById("licenseBuy").addEventListener('click', function(e){
        e.preventDefault();
        window.open("https://highlightthis.net/Subscription.html")    
    });

    document.getElementById('validateEnteredLicenseKey').addEventListener('click', function(e){
        e.preventDefault();
        getLicense(document.getElementById('enteredLicenseKey').value, function(response){
            if(response){
                showLicense()
            }
            else{
                document.getElementById('enteredLicenseFeedback').style.display='block';
                document.getElementById('enteredLicenseFeedback').innerHTML='Invalid key entered';
            }
        });
    })

    document.getElementById('sendErrorsButton').addEventListener('click', function(e){
        e.preventDefault();
        sendBugReport();
    })

    document.getElementById("action").addEventListener('change', function(e){
        displayActionOptions(e.target.value)
    })
    document.getElementById('actionLink').addEventListener('keyup', function(e){
        url=e.target.value.trim();
        actionURLValidation(url);
    })

    if (getBrowser()=="Firefox") {
        document.getElementById("uploadform").style.display="none";
        document.getElementById("importFFLink").style.display="block"; 
        document.getElementById("importFFLink").addEventListener('click',function(){
            //open a new form in the browser
            var creating = chrome.tabs.create({
                url:browser.runtime.getURL("import.html")
              });
            window.close();
        });
    }
    else {
        document.getElementById("uploadform").style.display="block";
        document.getElementById("importFFLink").style.display="none"; 
    }
}


//drag and drop
const wordData = document.getElementById('wordData');

let draggableBeingDragged = null;

let originalParent = null; // To store the original parent container of the draggable
let nextSibling = null;

wordData.addEventListener('dragover', e => {
    e.preventDefault();
    if (!draggableBeingDragged) return;

    const afterElement = getDragAfterElement(wordData, e.clientY);
    const draggable = draggableBeingDragged;
    if (afterElement == null) {
      wordData.appendChild(draggable);
    } else {
      wordData.insertBefore(draggable, afterElement);
    }
  });
  
  wordData.addEventListener('dragleave', e => {
    if (!wordData.contains(e.relatedTarget)) {
      cancelDrag();
    }
  });
  
  function getDragAfterElement(container, y) {
    const draggableElements = [...container.querySelectorAll('.wordListContainer:not(.dragging)')];
  
    return draggableElements.reduce((closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) {
        return { offset: offset, element: child };
      } else {
        return closest;
      }
    }, { offset: Number.NEGATIVE_INFINITY }).element;
  }
  
  function endDrag() {
    if (draggableBeingDragged) {
      draggableBeingDragged.classList.remove('dragging');
      draggableBeingDragged = null;
      const allLists=document.querySelectorAll('.wordListContainer');
      let orderedList=[];
      allLists.forEach(function(el){
        orderedList.push(el.getAttribute("groupid"))
      });
      setSetting('order', orderedList)
      console.log(orderedList)
    }
  }
  
  function cancelDrag() {
    if (draggableBeingDragged) {
      draggableBeingDragged.classList.remove('dragging');
      // Move the element back to its original position
      if (nextSibling) {
        originalParent.insertBefore(draggableBeingDragged, nextSibling);
      } else {
        originalParent.appendChild(draggableBeingDragged);
      }
      draggableBeingDragged = null;
    }
  }