#!/usr/bin/env groovy

def call(String helm_User, String helm_Pass, String helm_URL) {
        sh """
            echo Started Configuring Helm ...
            helm repo add --username $helm_User --password $helm_Pass project $helm_URL
            helm repo update
            echo Completed Configuring Helm ...
        """
    }
