# Jenkins Shared Libraries

This repository contains shared libraries for Jenkins, which enable code reuse and standardization across Jenkins pipelines. The shared libraries are organized into two folders: `resources` and `vars`. 

## Resources Folder

The `resources` folder is used to store any non-executable files that are required by the shared libraries. These files can include configuration files, templates, or any other resources that might be needed during the execution of Jenkins pipelines.

To use the resources stored in this folder, you can simply reference them by their relative paths within your pipeline scripts. For example:

```groovy
pipeline {
    agent any

    stages {
        stage('Example') {
            steps {
                // Access a resource file from the resources folder
                script {
                    def configFile = libraryResource('resources/config.json')
                    // Use the configFile in your pipeline logic
                }
            }
        }
    }
}
```

## Vars Folder

The `vars` folder contains Groovy scripts that define reusable pipeline steps and functions. These scripts are automatically loaded into the Jenkins pipeline runtime environment, allowing you to use them across multiple pipelines.

To utilize the shared steps and functions defined in the `vars` folder, you need to define the `@Library` annotation at the top of your pipeline script. This annotation specifies the name of the shared library and optionally the version to use. Here's an example:
```

`@Library('my-shared-library@main') _

pipeline {
    // Pipeline definition
    ...
}
```
Here main is the branch of the shared libraries repo.
For testing you can create new branch from main and test features and merge to main.

Once you've included the shared library in your pipeline, you can use the steps and functions defined in the `vars` folder just like any other built-in Jenkins pipeline step. For example:

```
pipeline {
    agent any

    stages {
        stage('Example') {
            steps {
                // Use a custom step from the shared library
                myCustomStep()
            }
        }
    }
}
```
