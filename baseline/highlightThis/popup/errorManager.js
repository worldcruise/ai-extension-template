function sendBugReport(){
    const analyticsEndpoint='https://api.highlightthis.net/api/analyticsService';

    var bugReport={};
    bugReport.description=document.getElementById('sendErrorsIssue').value;
    bugReport.email=document.getElementById('sendErrorsEmail').value;
    bugReport.version=chrome.runtime.getManifest().version;
    bugReport.installId=Settings.installId;
    chrome.storage.session.get(function(e){
        bugReport.log=e.errors;
        
        var requestObject={
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            method: "POST",
            body: JSON.stringify(bugReport)
        }
        fetch(analyticsEndpoint+'/bugReport',requestObject)         
        notify.bugReportSent();
        document.getElementById('sendErrorsIssue').value='';
        document.getElementById('sendErrorsEmail').value='';
        showHome();
    });
}