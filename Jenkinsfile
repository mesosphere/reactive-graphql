#!/usr/bin/env groovy

@Library('sec_ci_libs@v2-latest') _

def master_branches = ["master", ] as String[]

pipeline {
  agent {
    dockerfile {
      args  '--shm-size=2g'
    }
  }

  environment {
    JENKINS_VERSION = 'yes'
  }

  options {
    timeout(time: 1, unit: 'HOURS')
  }

  stages {
    stage('Authorization') {
      steps {
        user_is_authorized(master_branches, '8b793652-f26a-422f-a9ba-0d1e47eb9d89', '#frontend-dev')
      }
    }

    stage('Initialization') {
      steps {
        ansiColor('xterm') {
          retry(2) {
            sh '''npm install'''
          }
        }
      }
    }

    stage('Unit Test') {
      steps {
        ansiColor('xterm') {
          sh '''npm test'''
        }
      }
    }

    stage('Build') {
      steps {
        ansiColor('xterm') {
          sh '''npm run build'''
        }
      }

      post {
        always {
          archiveArtifacts 'dist/**/*'
        }
      }
    }

    stage("Release") {
      steps {
        withCredentials([
          string(credentialsId: 'mesosphere-frontend-ci-gh-token', variable: 'GH_TOKEN'),
          string(credentialsId: '1308ac87-5de8-4120-8417-b3fc8d5b4ecc', variable: 'NPM_TOKEN')
        ]) {
          sh "npx semantic-release"
        }
      }
    }
  }
}