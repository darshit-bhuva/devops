const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const axios = require('axios');
const bodyParser = require('body-parser');
const dotenv = require('dotenv');
const rateLimit = require('express-rate-limit');

dotenv.config();
const app = express();
app.set('trust proxy', 1);
app.use(bodyParser.json());

// In-memory store for SonarQube analysis data
const sonarAnalysisStore = new Map(); // Key: projectKey-MR_IID, Value: analysis_data

// Enhanced logging function
function log(step, message, data = {}) {
  const timestamp = new Date().toISOString();
  console.log(JSON.stringify({
    timestamp,
    step,
    message,
    data
  }, null, 2));
}

// Function to sanitize text for Slack blocks
function sanitizeForSlack(text) {
  if (!text) return '';
  let sanitized = text.replace(/```/g, '`');
  sanitized = sanitized.replace(/\*\*/g, '*');
  return sanitized;
}

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100
});
app.use(limiter);

const {
  GITLAB_TOKEN,
  GITLAB_API,
  GEMINI_API_KEY,
  SLACK_WEBHOOK_URL,
  PORT,
  GITLAB_WEBHOOK_SECRET,
  SONARQUBE_URL,
  SONARQUBE_TOKEN
} = process.env;

// Normalize SONARQUBE_URL to remove trailing slash
const normalizedSonarQubeUrl = SONARQUBE_URL?.replace(/\/+$/, '') || '';

// Validate required environment variables
const requiredEnvVars = [
  'GITLAB_TOKEN',
  'GITLAB_API',
  'GEMINI_API_KEY',
  'SLACK_WEBHOOK_URL',
  'PORT',
  'SONARQUBE_URL',
  'SONARQUBE_TOKEN'
];
const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);
if (missingEnvVars.length > 0) {
  console.error(`Missing required environment variables: ${missingEnvVars.join(', ')}`);
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

const gitlabHeaders = {
  'Private-Token': GITLAB_TOKEN
};

const sonarHeaders = {
  'Authorization': `Bearer ${SONARQUBE_TOKEN}`,
  'Accept': 'application/json'
};

// Retry configuration
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000;

// Helper function for retrying API calls
async function retryOperation(operation, maxRetries = MAX_RETRIES) {
  let lastError;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (error.response?.status === 429) {
        const retryAfter = error.response.headers['retry-after'] || RETRY_DELAY;
        await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
      } else {
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * Math.pow(2, i)));
      }
    }
  }
  throw lastError;
}

// Normalize file paths for consistent comparison
function normalizeFilePath(path) {
  if (!path) return '';
  return path.replace(/^\/+|\/+$/g, '').replace(/\\/g, '/');
}

// Normalize project key for consistency
function normalizeProjectKey(projectPath, branch) {
  if (!projectPath || !branch) return '';
  const repoName = projectPath.split('/').pop();
  return `${repoName}-${branch}`.toLowerCase();
}

// Validate webhook signature
function validateWebhookSignature(req) {
  if (!GITLAB_WEBHOOK_SECRET) return true;
  const signature = req.headers['x-gitlab-token'];
  if (!signature) return false;
  return signature === GITLAB_WEBHOOK_SECRET;
}

// Wait for SonarQube data with timeout
async function waitForSonarData(storeKey, maxWaitMs = 60000, pollIntervalMs = 5000) {
  const startTime = Date.now();
  while (Date.now() - startTime < maxWaitMs) {
    const sonarAnalysis = sonarAnalysisStore.get(storeKey);
    if (sonarAnalysis && sonarAnalysis.analysis_data) {
      log('SONARQUBE_DATA_FOUND', 'SonarQube data retrieved after waiting', {
        storeKey,
        waitTimeMs: Date.now() - startTime
      });
      return sonarAnalysis;
    }
    log('SONARQUBE_DATA_WAIT', 'Waiting for SonarQube data', {
      storeKey,
      elapsedMs: Date.now() - startTime
    });
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
  }
  log('SONARQUBE_DATA_TIMEOUT', 'Timeout waiting for SonarQube data, cannot proceed', { storeKey });
  throw new Error('Timed out waiting for SonarQube analysis data; cannot proceed with review');
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    services: {
      gitlab: true,
      gemini: true,
      slack: true,
      sonarqube: true
    }
  });
});

// SonarQube Webhook Endpoint
app.post('/sonarqube-webhook', async (req, res) => {
  try {
    const { project_key, MR_IID, repository, branch, analysis_data, build_url } = req.body;
    
    log('SONARQUBE_WEBHOOK_RECEIVED', 'Processing SonarQube analysis', {
      project_key,
      MR_IID,
      repository,
      branch,
      analysisDataStructure: JSON.stringify(analysis_data, null, 2)
    });

    // Validate inputs
    if (!project_key || !MR_IID || !repository || !branch || !analysis_data) {
      throw new Error('Missing required fields: project_key, MR_IID, repository, branch, or analysis_data');
    }

    // Normalize the project key to match the format used in /webhook
    const normalizedKey = normalizeProjectKey(repository, branch);
    const storeKey = `${normalizedKey}-${MR_IID}`;

    // Parse analysis_data subfields if they are strings
    let parsedAnalysisData;
    try {
      if (typeof analysis_data === 'string') {
        parsedAnalysisData = JSON.parse(analysis_data);
      } else {
        parsedAnalysisData = {
          analysis: typeof analysis_data.analysis === 'string' ? JSON.parse(analysis_data.analysis) : analysis_data.analysis,
          issues: typeof analysis_data.issues === 'string' ? JSON.parse(analysis_data.issues) : analysis_data.issues,
          measures: typeof analysis_data.measures === 'string' ? JSON.parse(analysis_data.measures) : analysis_data.measures,
          quality_gate: typeof analysis_data.quality_gate === 'string' ? JSON.parse(analysis_data.quality_gate) : analysis_data.quality_gate
        };
      }
    } catch (parseError) {
      log('SONARQUBE_DATA_PARSE_ERROR', 'Failed to parse analysis_data', {
        error: parseError.message,
        rawData: JSON.stringify(analysis_data, null, 2)
      });
      throw new Error('Invalid analysis_data format: unable to parse JSON');
    }

    // Validate required subfields
    if (!parsedAnalysisData.issues || !parsedAnalysisData.measures || !parsedAnalysisData.quality_gate) {
      log('SONARQUBE_DATA_VALIDATION_ERROR', 'Missing required subfields in analysis_data', {
        parsedData: JSON.stringify(parsedAnalysisData, null, 2)
      });
      throw new Error('Invalid analysis_data: missing required subfields (issues, measures, or quality_gate)');
    }

    // Store analysis data
    sonarAnalysisStore.set(storeKey, {
      project_key,
      MR_IID,
      repository,
      branch,
      analysis_data: parsedAnalysisData,
      build_url,
      timestamp: Date.now()
    });

    log('SONARQUBE_DATA_STORED', 'Stored SonarQube analysis data', {
      storeKey,
      analysisIssues: parsedAnalysisData.issues?.issues?.length || 0,
      analysisMeasures: parsedAnalysisData.measures?.component?.measures?.length || 0,
      qualityGateStatus: parsedAnalysisData.quality_gate?.projectStatus?.status || 'N/A'
    });

    res.status(200).json({ success: true, message: 'SonarQube analysis data received and stored' });
  } catch (error) {
    log('SONARQUBE_WEBHOOK_ERROR', 'Error processing SonarQube webhook', {
      error: error.message,
      stack: error.stack
    });
    res.status(500).json({ error: error.message });
  }
});

// Webhook Endpoint
app.post('/webhook', async (req, res) => {
  if (!validateWebhookSignature(req)) {
    log('WEBHOOK_VALIDATION', 'Invalid webhook signature');
    return res.status(401).send('Invalid webhook signature');
  }

  const event = req.body;
  if (!event.object_attributes || !event.project || !event.user) {
    log('WEBHOOK_VALIDATION', 'Invalid webhook payload', { event });
    return res.status(400).send('Invalid webhook payload');
  }

  const action = event.object_attributes?.action;
  if (action !== 'open' && action !== 'update') {
    log('WEBHOOK_IGNORED', 'Ignored non-open/update MR event', { action });
    return res.status(200).send('Ignored non-open/update MR event.');
  }

  try {
    const projectId = encodeURIComponent(event.project.path_with_namespace);
    const mrIid = event.object_attributes.iid;
    const mrTitle = event.object_attributes.title;
    const author = event.user.name;
    const projectKey = normalizeProjectKey(event.project.path_with_namespace, event.object_attributes.source_branch);

    log('MR_PROCESSING_START', 'Starting MR processing', { 
      projectId, 
      mrIid, 
      mrTitle,
      author,
      projectKey
    });

    // 1. Fetch MR changes
    const mrUrl = `${GITLAB_API}/projects/${projectId}/merge_requests/${mrIid}/changes`;
    const diffRes = await retryOperation(() => 
      axios.get(mrUrl, {
        headers: gitlabHeaders,
        transformRequest: [(data, headers) => data]
      })
    );

    log('GITLAB_SUCCESS', 'Fetched MR changes successfully', {
      filesChanged: diffRes.data.changes.length
    });
    
    const changes = diffRes.data.changes.map(f => `File: ${f.new_path}\n${f.diff}`).join('\n---\n');
    const changedFiles = diffRes.data.changes.map(f => f.new_path);

    // 2. Wait for SonarQube analysis data before proceeding
    const storeKey = `${projectKey}-${mrIid}`;
    const sonarAnalysis = await waitForSonarData(storeKey, 60000, 5000); // Wait up to 60 seconds, poll every 5 seconds

    // 3. Validate and filter SonarQube issues for changed files
    const normalizedChangedFiles = changedFiles.map(normalizeFilePath);
    const analysisData = sonarAnalysis.analysis_data || {};
    const issues = analysisData.issues?.issues || [];
    if (!Array.isArray(issues)) {
      log('SONARQUBE_DATA_ERROR', 'Invalid or missing issues array in analysis_data', {
        storeKey,
        analysisData: JSON.stringify(analysisData, null, 2)
      });
      throw new Error('Invalid SonarQube analysis data: issues array is missing or not an array');
    }

    const filteredIssues = issues.filter(issue => {
      const issuePath = normalizeFilePath(issue.component?.split(':').pop());
      return normalizedChangedFiles.some(changedFile => 
        issuePath.includes(changedFile) || 
        changedFile.includes(issuePath.split('/').pop())
      );
    });

    log('SONARQUBE_ISSUES_FILTERED', 'Filtered SonarQube issues for MR', {
      originalCount: issues.length,
      filteredCount: filteredIssues.length
    });

    // 4. Format SonarQube metrics for MR-specific issues
    const measures = analysisData.measures?.component?.measures || [];
    const qualityGate = analysisData.quality_gate?.projectStatus || {};

    const formatMeasure = (key) => {
      const measure = measures.find(m => m.metric === key);
      return measure ? `${measure.value} (${measure.metric})` : 'N/A';
    };

    const sonarMetrics = `

**Issues in Changed Files**:
${filteredIssues.map(issue => `
*${issue.type || 'UNKNOWN'}*: ${issue.message || 'No message'}
- Severity: ${issue.severity || 'N/A'}
- Location: ${issue.component || 'N/A'}:${issue.line || 'N/A'}
- Rule: ${issue.rule || 'N/A'}
`).join('\n') || 'No issues found in changed files'}
    `;

    // 5. Prepare prompt for LLM analysis
    const prompt = `
You are an expert code reviewer analyzing a GitLab merge request and its SonarQube analysis report.

PR Title: "${mrTitle}"
Author: ${author}

**Tasks:**
1. Code Review:
   - Review syntax, formatting, and potential bugs in the changed files
   - Check coding standards and conventions (e.g., consistent naming, commenting)
   - Evaluate comments, documentation, and variable names
   - Identify security vulnerabilities, especially related to environment variable handling
   - Check error handling and edge cases

2. SonarQube Analysis Detailed:
   - Analyze SonarQube metrics (bugs, vulnerabilities, code smells, coverage, duplications, security hotspots)
   - Identify critical issues and their impact
   - Suggest remediation for high-priority issues
   - Evaluate code quality metrics

3. Performance & Optimization:
   - Identify optimization opportunities in the changed code
   - Look for redundant code or inefficient patterns
   - Suggest modularization where applicable
   - Analyze memory usage and expensive operations
   - Check database queries/API calls

4. Best Practices:
   - Suggest refactoring opportunities for the MR
   - Recommend maintainability improvements
   - Identify technical debt in the changed code

5. Developer Experience:
   - Provide code examples for improvements, especially for secure data handling
   - Link to documentation (e.g., Node.js process.env, SonarQube rules)
   - Suggest tools/extensions (e.g., ESLint, security linters)
   - Identify debugging challenges

**Output Format (Slack markdown):**
- Use *bold* for headings
- Use - for bullet points
- Use > for important notes
- Use \`code\` for code snippets
- Keep sections concise

*Summary*
[Overview of MR and filtered SonarQube findings]

*Key Changes*
- [List major changes and their impact]

*SonarQube Analysis*
- [List key metrics and issues along with their references causing it]

*Code Quality Analysis*
- [List code quality findings for changed files]

*Performance Considerations*
- [List performance findings for MR]

*Security Review*
- [List security findings, focusing on sensitive data exposure]

*Developer Tips*
- [List developer tips for secure coding]

*Suggested Improvements*
- [List improvements with code examples, e.g., safe env handling]

*Time Estimate*
[Estimate hours for a senior developer]

*Additional Resources*
- [List documentation/tools, e.g., https://docs.sonarqube.org/latest/analysis/rules/]

**Changes to Review:**
${changes}

**SonarQube Findings (Filtered for MR):**
${sonarMetrics}
`;

    log('PROMPT_PREPARED', 'Prompt prepared for Gemini analysis', {
      promptLength: prompt.length
    });    

    // 6. Gemini Analysis
    const result = await retryOperation(async () => {
      const response = await model.generateContent(prompt);
      return response?.response?.candidates[0]?.content?.parts[0]?.text;
    });

    log('GEMINI_COMPLETE', 'Gemini analysis completed', {
      resultLength: result?.length || 0
    });

    // 7. Post to GitLab MR Comments
    try {
      const gitlabCommentUrl = `${GITLAB_API}/projects/${projectId}/merge_requests/${mrIid}/notes`;
      
      const gitlabCommentBody = {
        body: `## Code Review and SonarQube Analysis for MR #${mrIid}\n\n${sanitizeForSlack(result)}`
      };

      await retryOperation(() => 
        axios.post(gitlabCommentUrl, gitlabCommentBody, { headers: gitlabHeaders })
      );
      log('GITLAB_COMMENT_SUCCESS', 'Successfully posted comment to GitLab MR');

      // Clear stored SonarQube data
      sonarAnalysisStore.delete(storeKey);
      log('SONARQUBE_DATA_CLEARED', 'Cleared stored SonarQube data', { storeKey });
    } catch (gitlabErr) {
      log('GITLAB_COMMENT_ERROR', 'Error posting comment to GitLab', {
        error: gitlabErr.message
      });
      throw new Error('Failed to post review to GitLab');
    }

    log('PROCESS_COMPLETE', 'MR processing completed successfully');
    res.status(200).send('Handled successfully');
  } catch (err) {
    console.error('❌ Error processing webhook:', {
      error: err.message,
      stack: err.stack,
      projectId: event.project?.path_with_namespace,
      mrIid: event.object_attributes?.iid
    });
    res.status(500).send('Something went wrong');
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

app.listen(PORT, () => {
  log('SERVER_START', 'Webhook server started', {
    port: PORT,
    healthCheckUrl: `http://localhost:${PORT}/health`
  });
  console.log(`🟢 Webhook server running on port ${PORT}`);
  console.log(`🔍 Health check available at http://localhost:${PORT}/health`);
});