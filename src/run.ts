// Copyright 2020-2021 Buf Technologies, Inc.
//
// All rights reserved.

import * as core from '@actions/core';
import * as github from '@actions/github'
import * as io from '@actions/io';
import * as path from "path";
import cp from 'child_process';
import { lint } from './buf';
import { Error, isError } from './error';
import { postComments } from './github';

export async function run() {
    try {
        const result = await runLint()
        if (isError(result)) {
            core.setFailed(result.errorMessage);
        }
    } catch (error) {
        // In case we ever fail to catch an error
        // in the call chain, we catch the error
        // and mark the build as a failure. The
        // user is otherwise prone to false positives.
        core.setFailed(error.message);
    }
}

// runLint runs the buf-lint action, and returns
// a non-empty error if it fails.
async function runLint(): Promise<void|Error> {
    const authenticationToken = core.getInput('github_token');
    if (authenticationToken === '') {
        return {
            errorMessage: 'a Github authentication token string was not provided'
        };
    }
    const input = core.getInput('input');
    if (input === '') {
        return {
            errorMessage: 'an input string was not provided'
        };
    }
    const owner = github.context.repo.owner;
    if (owner === '') {
        return {
            errorMessage: 'an owner string was not provided'
        };
    }
    const repository = github.context.repo.repo;
    if (repository === '') {
        return {
            errorMessage: 'a repository string was not provided'
        };
    }
    const binaryPath = await io.which('buf', true);
    if (binaryPath === '') {
        // TODO: Update this reference to a link to the repository once it's available.
        return {
            errorMessage: 'buf is not installed; please add the "bufbuild/setup-buf" step to your job'
        };
    }

    const result = lint(binaryPath, input);
    if (isError(result)) {
        return result
    }
    if (result.fileAnnotations.length === 0) {
        core.info('No lint errors were found.');
        return;
    }

    const pullRequestNumber = github.context.payload.pull_request?.number;
    if (pullRequestNumber !== undefined) {
        // If this action was configured for pull requests, we post the
        // FileAnnotations as comments.
        try {
            await postComments(
                authenticationToken,
                owner,
                repository,
                pullRequestNumber,
                result.fileAnnotations,
            );
        } catch (error) {
            // Log the error, but continue so that we still write
            // out the raw output to the user.
            core.info(`Failed to write comments in-line: ${error}`);
        }
    }

    // Include the raw output so that the console includes sufficient context.
    return {
        errorMessage: `buf found ${result.fileAnnotations.length} lint failures.\n${result.raw}`
    };
}
