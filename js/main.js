// Fetch data and populate projects and blogs
async function loadData() {
    const projectResponse = await fetch('projects.json');
    const blogResponse = await fetch('blogs.json');

    const projects = await projectResponse.json();
    const blogs = await blogResponse.json();

    populateProjects(projects);
    populateBlogs(blogs);
}

function populateProjects(projects) {
    const projectList = document.getElementById('project-list');
    projects.forEach((project) => {
        const projectHTML = `
            <div class="card">
                <img src="${project.image}" alt="${project.title}">
                <h3>${project.title}</h3>
                <p>${project.description}</p>
                <a href="${project.link}">View Details</a>
            </div>
        `;
        projectList.innerHTML += projectHTML;
    });
}

function populateBlogs(blogs) {
    const blogList = document.getElementById('blog-list');
    blogs.forEach((blog) => {
        const blogHTML = `
            <div class="card">
                <h3>${blog.title}</h3>
                <p>${blog.snippet}</p>
                <a href="${blog.link}">Read More</a>
            </div>
        `;
        blogList.innerHTML += blogHTML;
    });
}

// Call the loadData function
loadData();
