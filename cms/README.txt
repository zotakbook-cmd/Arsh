GREEN INDIA SAFETY INSTITUTE CMS
================================

Files:
  cms/index.html       CMS admin frontend
  cms/CMS_Backend.gs   Google Apps Script CMS backend

1) Put cms/index.html in the GitHub repository at:
   /cms/index.html

2) Add CMS_Backend.gs to the SAME Apps Script project as the existing website backend.

3) Add the CMS routing to your existing doGet:

   case "cmsLogin":
   case "getCMSData":
   case "getCMSSheet":
     return cmsDoGet_(params);

4) Add this at the beginning of your existing doPost(e):

   var cmsAction = String((e && e.parameter && e.parameter.action) || "");
   if (cmsAction.indexOf("cms") === 0 ||
       cmsAction === "uploadGitHubImage" ||
       cmsAction === "deleteGitHubImage") {
     return cmsDoPost_(e);
   }

5) Apps Script > Project Settings > Script Properties:
   GITHUB_TOKEN   = GitHub fine-grained token
   GITHUB_OWNER   = your GitHub username/org
   GITHUB_REPO    = repository name
   GITHUB_BRANCH  = main
   SITE_BASE_URL  = https://arsh.libgo.in

GitHub token permissions:
- Contents: Read and write
- Metadata: Read-only
Use a fine-grained token and only the required repository.
NEVER put the token in cms/index.html or index.html.

6) Admin authentication:
   The CMS uses the existing Admin sheet.
   Admin Type must be Admin or SuperAdmin.

7) Supported website sheets:
   Settings, Menu, Hero, Stats, About, AboutPoints, Features,
   CourseDB, Faculty, Gallery, Testimonials, Notices, Contact,
   Social, FAQ, StudentDB

The CMS is generic: it reads the first row of each sheet as column headers,
and builds the editor from those headers. Existing sheet data is not recreated.

8) Image upload:
   The browser compresses normal photos to WebP (max 1800px), then sends them
   through a temporary popup POST to Apps Script. Apps Script uploads the image
   to GitHub and returns a public URL based on SITE_BASE_URL.

IMPORTANT:
The current public index.html still contains some premium sections as static HTML
(Learning Journey, Institute Promise and FAQ content). To make those sections fully
CMS-controlled, the public index.html must also be updated to load dedicated sheet
records and render them dynamically. The generic CMS can already manage FAQ rows,
but the public frontend needs that final integration step.
