---
title: "Lunar Crater Detection and Depth Analysis"
subtitle: "Deep Learning for Lunar Surface Analysis"
tags: ["Python", "Keras", "OpenCV", "YOLOv5", "R-CNN", "NumPy"]
image: "/images/crater.jpg"
githubUrl: "https://github.com/sanjjayrj"
paperUrl: "https://doi.org/10.1007/s12524-024-01909-y"
---

## Overview

This project leveraged deep learning techniques to detect craters on the lunar surface using satellite imagery from India's Chandrayaan-2 mission. It was built as part of a research initiative for lunar mapping and resulted in a publication in the **Journal of the Indian Society of Remote Sensing**.

## Data Preparation

The imagery was captured by the **Optical High Resolution Camera (OHRC)** on Chandrayaan-2, covering areas of 12km x 3km with a ground resolution of 0.19m (19cm). Each image contained approximately 1 million pixels.

Given the enormous image size, we used the **PDS4 (Planetary Data System)** format to crop each image into smaller 640x640 pixel segments covering 120m x 120m each. Over **900+ images** were manually labelled using RoboFlow.

## Model Architecture

Two object detection models were trained:

- **R-CNN** for baseline crater detection
- **YOLOv5** for faster, real-time capable detection

Both models were trained on Google Colab Pro to handle the computational requirements of the large dataset.

## Geospatial Analysis

Beyond detection, we implemented a **geospatial coordinate tracking and depth analysis algorithm** to estimate the location and depth of detected craters. This information is critical for identifying potential landing spots on the lunar surface.

## Results

- **85-92% detection accuracy** on test datasets
- Successfully identified craters ranging from 10-100m in diameter
- Depth estimation based on crater diameter correlation

## Challenges

The biggest challenge was manual labelling — some smaller craters (1-10m diameter) were missed during annotation. Since the research focused on suggesting landing spots, omitting sub-10m craters was acceptable. Techniques like **oversampling and data augmentation** were used to address underrepresentation of smaller features.

## Outcome

Published in the **Journal of the Indian Society of Remote Sensing** — recognized as an innovative application of AI in space exploration.
