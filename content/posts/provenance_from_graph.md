---
title : 'Computing the provenance from the software heritage graph'
date : 2024-02-03T20:01:01+01:00
draft : true
authors: ["charlyreux"]
categories:
  - projects
tags:
  - software engineering
  - software heritage
  - dev
slug: provenance-from-graph
toc: true
---

In the context of the work I do in relation to the software heritage initiative, I had the opportunity to work on the computation of the provenance of commits from a graph representation of all the source code available in the world.


## Context
To give a bit more context, Software heritage is an initiative with the purpose of saving all the source code ever created, the architecture that is implemented behind it is quite massive, and the amount of data is pretty huge.

I won't explain much of it in this post, but basically, there are currently 18T source files, 4T commits, and 300M projects that are stored in the archive (and they are all deduplicated). You can see all of that for yourself [here](https://archive.softwareheritage.org/).

All of this data allows for some fascinating analysis, but first I need to introduce the data structure that is used and how we can use it.

## The data model
Software artifacts are stored following the git data model, the only change is the usage of snapshots. Everything is detailed [here](https://docs.softwareheritage.org/devel/swh-model/data-model.html), but for our use case the only things you need to know are:
- *origins* contain the URLs of the repositories.
- *snapshots* are the state of the repository at a certain date.
- *releases* are litteral releases of the software save.
- *revisions* is just another name for commits.
- *directories* and *content* are exactly what you think they are.

![data_model](/assets/images/provenance_from_graph/data_model.png)

In order to deal with all of that data, software heritage give us access to a read-only compressed graph representation, and APIs in multiple languages that allows us to explore the graph.

## My objective

As I said, my goal was to find the provenance of all the commits in that graph (What I mean by provenance is simply the URL of the repository from which the commit originated), and to get a map, mapping a commit id to a list of urls.

*Why a list of urls?*, you might say. Well, a graph representation speaks louder than a thousand word.

![example_fork_diagram](/assets/images/provenance_from_graph/Commit_graph.drawio.svg)

Let's say we have this example where two repositories, the Linux kernel, and a fork of the Linux kernel. The commit A, in reality, belongs to the original Linux repository. However, there is no way for us with that architecture, to know whether that commit is from Linux or the fork because in practice this commit is in both repository.

But as solving this issue was not necessary from my use case, my goal was "simply" to get a map like this:
```
A -> ["github.com/linux_fork.git","github.com/linux.git"]
B -> ["github.com/linux.git"]
C -> ["github.com/linux.git"]
D -> ["github.com/linux_fork.git"]
E -> ["github.com/linux_fork.git"]
```

You can take a few seconds to try to find the possible methods to achieve that goal, knowing that this is a simplified example, in reality I had to deal with ~4T commits. 

## How I did it
### First Implementation
The first intuition was to start from the origins (the cloud in the diagram) and to go down the commits and tag all of them along the way.  
> Easy right?

Indeed, pretty easy to implement, and quite a simple approach. However, when dealing with an amount of data that big, this did not scale at all.  
So I added parallelism, by having a thread starting on each origin and tagging all the commits along the way (ensuring of course that two thread would not r the value written in the map), but yet again, it did not scale at all.

So we had to come up with something more clever.