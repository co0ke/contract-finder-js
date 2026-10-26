/**
 * Canned job-site responses for running without the real APIs. Shapes are trimmed from real responses
 * (the same ones the tests use); dates are relative to "now" so the adverts stay inside the search window.
 */

const MsPerDay = 24 * 60 * 60 * 1000;
const daysAgo = (now, days, hour = 9) => {
  const d = new Date(now.getTime() - days * MsPerDay);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hour, 15, 0));
};
const pad = (n) => String(n).padStart(2, '0');
const ukDate = (d) => `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;

/** @param {Date} now */
export function adzunaResponse(now) {
  return {
    count: 4,
    results: [
      {
        id: '4001', title: 'Senior .NET Developer - Contract', description: 'Outside IR35. C# 12, Azure Functions, Cosmos DB. Hybrid, 2 days in London.',
        created: daysAgo(now, 1).toISOString(), redirect_url: 'https://www.adzuna.co.uk/jobs/land/ad/4001',
        salary_min: 143000, salary_max: 156000, salary_is_predicted: '0',
        company: { display_name: 'Contoso Recruitment' }, location: { display_name: 'London, UK' },
      },
      {
        id: '4002', title: 'Azure Platform Engineer', description: 'Bicep, AKS and GitHub Actions for a retail bank. Inside IR35.',
        created: daysAgo(now, 2).toISOString(), redirect_url: 'https://www.adzuna.co.uk/jobs/land/ad/4002',
        salary_min: 600, salary_max: 650, salary_is_predicted: '1',
        company: { display_name: 'Fabrikam Consulting' }, location: { display_name: 'Manchester, UK' },
      },
      {
        id: '4003', title: 'Java Developer (Contract)', description: 'Java 21, Spring Boot, Kafka.',
        created: daysAgo(now, 2).toISOString(), redirect_url: 'https://www.adzuna.co.uk/jobs/land/ad/4003',
        salary_min: 500, salary_max: 550, salary_is_predicted: '0',
        company: { display_name: 'Northwind Talent' }, location: { display_name: 'Leeds, UK' },
      },
      {
        id: '4004', title: 'Network Engineer', description: 'Cisco and Juniper. Competitive net salary.',
        created: daysAgo(now, 3).toISOString(), redirect_url: 'https://www.adzuna.co.uk/jobs/land/ad/4004',
        salary_min: 400, salary_max: 450, salary_is_predicted: '1',
        company: { display_name: 'Tailspin Networks' }, location: { display_name: 'Bristol, UK' },
      },
    ],
  };
}

/** @param {Date} now */
export function reedResponse(now) {
  return {
    totalResults: 3,
    results: [
      {
        // The same role as Adzuna's 4001 (Adzuna also indexes Reed), to show de-duplication.
        jobId: 55001, employerName: 'Contoso Recruitment', jobTitle: 'Senior .NET Developer – Contract', locationName: 'London',
        minimumSalary: 550.0, maximumSalary: 600.0, currency: 'GBP', date: ukDate(daysAgo(now, 1)),
        jobDescription: 'Outside IR35. C# 12, Azure Functions, Cosmos DB.', jobUrl: 'https://www.reed.co.uk/jobs/senior-net-developer/55001',
      },
      {
        jobId: 55002, employerName: 'Woodgrove Bank', jobTitle: 'Backend Engineer', locationName: 'Edinburgh',
        minimumSalary: 450.0, maximumSalary: 500.0, date: ukDate(daysAgo(now, 4)),
        jobDescription: 'Build payment APIs for our core platform. Stack agnostic team.', jobUrl: 'https://www.reed.co.uk/jobs/backend-engineer/55002',
      },
      {
        jobId: 55003, employerName: 'Litware', jobTitle: 'Interim Payroll Manager', locationName: 'Remote',
        date: ukDate(daysAgo(now, 2)), jobDescription: 'Payroll Manager. Contract: 3 months. IR35: Inside IR35.',
        jobUrl: 'https://www.reed.co.uk/jobs/interim-payroll-manager/55003',
      },
    ],
  };
}

export function emagineResponse() {
  return {
    items: [
      {
        id: 180255, title: 'C# Backend Engineer ', startDate: 'ASAP', duration: '> 12 months', isPartTime: false,
        jobAdWorkLocation: { workLocationType: 'Hybrid', city: 'London', region: null, country: 'United Kingdom' },
      },
      {
        id: 180483, title: 'Développeur .net Angular (h/f)', startDate: 'ASAP', duration: '> 12 months', isPartTime: false,
        jobAdWorkLocation: { workLocationType: 'Hybrid', city: 'Suresnes', region: null, country: 'France' },
      },
      {
        id: 180300, title: 'Data Engineer', startDate: null, duration: '6 months', isPartTime: false,
        jobAdWorkLocation: { workLocationType: 'Remote', city: 'Leeds', region: null, country: 'United Kingdom' },
      },
      {
        id: 179500, title: 'Client Delivery Director', startDate: 'ASAP', duration: 'Permanent Position', isPartTime: false,
        jobAdWorkLocation: { workLocationType: 'Hybrid', city: 'London', region: null, country: 'United Kingdom' },
      },
    ],
    totalCount: 4,
  };
}

/** @param {Date} now */
export function techJobsResponse(now) {
  return {
    jobs: [
      {
        id: '11111111-1111-1111-1111-111111111111', slug: 'senior-c-developer-gcs-abc123', title: 'Senior C# Developer',
        organizationName: 'GCS', town: 'London', city: 'London', country: 'United Kingdom', jobType: 'inside-ir35',
        salaryMin: '400.00', salaryMax: '416.00', salaryType: 'daily', shortDescription: 'C#, Azure, SQL Server...',
        postedAt: daysAgo(now, 0, 7).toISOString(),
      },
      {
        id: '22222222-2222-2222-2222-222222222222', slug: 'net-architect-xyz', title: '.NET Architect',
        organizationName: 'Contoso', town: null, city: null, jobType: 'outside-ir35',
        salaryMin: '120000.00', salaryMax: '130000.00', salaryType: 'annual', shortDescription: null,
        postedAt: daysAgo(now, 5).toISOString(),
      },
    ],
    total: 2,
  };
}

/** @param {Date} now */
export function jobServePage(now) {
  const posted = (days) => {
    const d = daysAgo(now, days, 17);
    return `${ukDate(d)} ${pad(d.getUTCHours())}:06:26`;
  };
  const item = (id, title, location, rate, type, company, skills, postedDate) => `
    <div class="jobListItem newjobsum" id="${id}"><div class="jobListHeaderPanel"><a href="/gb/en/find-jobs-in-United-Kingdom/${title.replace(/[^A-Za-z0-9]+/g, '-').toUpperCase()}-${id}/" class="jobListPosition">${title}</a></div>
    <div class="jobListDetailsPanel"><label class="jobListLabel left ">Location</label><span id="summlocation" class="jobListDetail left">${location}</span><label class="jobListLabel left ">Rate</label><span id="summrate" class="jobListDetail left">${rate}</span><label class="jobListLabel left ">Type</label><span id="summtype" class="jobListDetail left">${type}</span><label class="jobListLabel left">Employment Business</label><span class="jobListDetail left"><a href="#">${company}</a></span></div>
    <div class="jobListSkillsPanel"><p class="jobListSkills">${skills}&nbsp; <a href="W${id}.jsjob">more&nbsp;-&gt;</a></p><label class="jobListLabel left ">Posted Date</label><span id="summposteddate" class="jobListDetail left">${postedDate}</span></div></div>`;
  return `<html><body><form id="frm1"><div id="joblistingcollection">
    ${item('8F26A5460F70CE6D02', '.Net Azure Developer - contract - remote - inside IR35', 'Remote , UK', '£325/Day', 'Contract', 'TrinIT Talent Ltd', 'TrinIT Talent are looking for a .NET Azure Developer to come on board for a 6 month contract...', posted(1))}
    ${item('18688A4E94EEC628F7', '.Net Developer', 'Southampton/Remote, UK', '£55k-60k', 'Permanent', 'Project Recruit', '.NET Developer - .NET/C#/APIs...', posted(1))}
    ${item('F827AF2E80CF7D71E8', 'Full-Stack Developer (Azure and React)', 'Wokingham, UK', '£450 - £500 per day', 'Contract', 'Project Recruit', 'Full-Stack Developer with Azure and React for a 12 month engagement.', posted(3))}
  </div></form></body></html>`;
}

/** What JobServe sends, with a 200, once it starts blocking a client. */
export const jobServeBlockedPage = '<html>\r\n<head>\r\n    <title></title>\r\n</head>\r\n<body>\r\n\r\n</body>\r\n</html>';
