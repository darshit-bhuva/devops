#!/usr/bin/env groovy

def call(String env, String dockerfile, String project ,String options =""){
    sh """
      echo Started Building...
      echo options are : ${options}
      #!/busybox/sh
      export PATH="/busybox:/kaniko:$PATH"
      /kaniko/executor --context `pwd` --dockerfile devops/${dockerfile} --destination $FW_ECR_URL$BUILD_NAME:$CI_COMMIT_SHA ${options} --insecure || true
      echo Built and Pushed Images to ECR...
    """
}


// ECR_URL
// BUILD_NAME
// CI_COMMIT_SHA
// FW_REGION
//These are required to setup to use this method
