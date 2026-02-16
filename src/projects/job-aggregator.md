---
title: "Job Aggregator AI Agent"
subtitle: "Conversational Job Recommendation System"
tags: ["Python", "OpenAI", "Flask", "React", "MongoDB", "NLTK"]
image: "/images/job.png"
githubUrl: "https://github.com/sanjjayrj/Job-Aggregator-Conversational-Gen-AI-Agent"
---

## Overview

The Job Aggregator Agent is an intelligent system designed to extract, aggregate, and present job opportunities from various platforms. Using generative AI techniques, it structures unstructured job postings into a clean, queryable format, tailored for the NYC job market.

## Key Features

- Processes user resume and preferences to scrape **1000+ job listings** from the last 72 hours
- Automatically scrapes job postings from multiple platforms (LinkedIn, Indeed)
- Uses a generative AI model to parse unstructured job descriptions into structured data
- Prompt engineered GenAI agent that understands user queries to update recommendations
- State-of-the-art **matching algorithm** to rank top 20 jobs for recommendation
- Agent provides **career advice** based on resume and top recommendations
- Dynamically scrapes, matches, and updates recommendations based on conversation

## Technical Stack

- **Backend:** Python, Flask, BeautifulSoup/Scrapy
- **AI:** OpenAI APIs for text parsing and embedding
- **Frontend:** React for user interaction
- **Data:** Pandas, Matplotlib for processing and visualization
- **Database:** MongoDB for job postings

## Challenges

One challenge was handling inconsistencies in job posting formats across platforms. Leveraging OpenAI's GPT APIs allowed standardization of this data efficiently. Another learning was optimizing scraping techniques with rate limiting and caching strategies.

Increased job volume led to higher cloud computing costs. This was optimized by storing previously created embeddings in a JSON file, retrieved when similar jobs were scraped — reducing API calls to OpenAI.

Prompt engineering required experimentation to handle the variety of user queries. Multiple prompts were designed to categorize inputs into scraping/matching operations or career advice.

## Outcome

The agent streamlined the job search process, saving users hours of manual effort. It demonstrated potential for integration with larger HR systems or as a standalone job board service.
