---
title: "ThisJustIn"
subtitle: "Gen-AI Powered Personalized Short-Form Video News"
tags: ["FastAPI", "AWS", "SwiftUI", "Docker", "GenAI", "Signal Protocol", "PostgreSQL", "OpenSearch"]
image: "/images/about_1.png"
githubUrl: null
---

## Overview

ThisJustIn is a personalized short-form video news platform where users can sign up and receive content from creators they trust, powered by a custom algorithm that maps their political alignment and interests. The platform includes a trending section for the latest US news and full community features including groups, messaging, and video forwarding.

## Architecture

The backend is built with **FastAPI** and deployed as multi-role **Docker containers** on **AWS ECS/Fargate**:

- **API Container** — Handles all client requests
- **Ingest Worker** — Processes incoming video content and metadata
- **Push Worker** — Manages push notifications
- **HLS Worker** — Handles video transcoding and streaming

Infrastructure includes **AWS ALB** for load balancing, **CloudFront CDN** for content delivery, **OpenSearch Serverless** for search, **EventBridge** for scheduling, and **CloudWatch Container Insights** for monitoring.

## Personalization Algorithm

A custom algorithm plots user political alignment across multiple dimensions and recommends content from creators that match their preferences. The explore page surfaces trending content nationally, providing exposure to diverse viewpoints while maintaining personalized feeds.

## E2E Encrypted Messaging

Messaging is built with the highest security standards using **Signal Protocol patterns**:

- **X25519** key exchange for establishing shared secrets
- **AES-256-GCM** encryption for message content
- **HKDF** key derivation for generating encryption keys
- **Forward secrecy** via ephemeral keypairs — compromise of long-term keys doesn't expose past messages
- **PIN-based key backup** with PBKDF2-SHA256 (100K iterations) stored in iOS Keychain

## Hybrid Search

The search system combines multiple approaches for maximum relevance:

- **SSE Streaming** for real-time search results
- **PostgreSQL BM25** for text-based ranking
- **pgvector HNSW** for vector similarity search
- **AWS Bedrock Titan** embeddings for semantic understanding
- **OpenSearch** with reciprocal rank fusion for combining results
- **Agentic AI-powered creator briefings** with Claude-generated story recommendations and events timeline aggregation

## iOS App

The iOS app is built in **SwiftUI/UIKit** with:

- **Supabase RealTime Broadcast Channels** for instant message delivery
- Typing indicators and presence detection
- **LRU video caching** for smooth infinite-scroll feeds

## CI/CD & Infrastructure

- **CI/CD pipelines** with GitHub Actions and AWS ECR for rapid iteration
- Database schema design, migrations, and performance tuning for high-throughput workloads
- Full observability with CloudWatch Container Insights
