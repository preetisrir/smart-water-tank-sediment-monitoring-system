/* =========================================================
   SMART TANK
   Frontend-only JavaScript
   Mock data only
   ========================================================= */


/* =========================================================
   NAVIGATION
   ========================================================= */

const navItems = document.querySelectorAll(".nav-item");
const pages = document.querySelectorAll(".page");


function showPage(pageId) {

    pages.forEach(function(page) {
        page.classList.remove("active-page");
    });

    navItems.forEach(function(item) {
        item.classList.remove("active");
    });


    const selectedPage = document.getElementById(pageId);

    const selectedNav =
        document.querySelector(
            `.nav-item[data-page="${pageId}"]`
        );


    if (selectedPage) {
        selectedPage.classList.add("active-page");
    }

    if (selectedNav) {
        selectedNav.classList.add("active");
    }


    closeMobileSidebar();


    window.scrollTo({
        top: 0,
        behavior: "smooth"
    });
}


navItems.forEach(function(item) {

    item.addEventListener("click", function() {

        showPage(this.dataset.page);

    });

});


/* =========================================================
   DASHBOARD PAGE LINKS
   ========================================================= */

const pageLinks =
    document.querySelectorAll("[data-page-link]");


pageLinks.forEach(function(link) {

    link.addEventListener("click", function() {

        showPage(this.dataset.pageLink);

    });

});


/* =========================================================
   MOBILE SIDEBAR
   ========================================================= */

const menuButton =
    document.getElementById("menuButton");

const sidebar =
    document.getElementById("sidebar");

const sidebarOverlay =
    document.getElementById("sidebarOverlay");


function closeMobileSidebar() {

    sidebar.classList.remove("mobile-open");

    sidebarOverlay.classList.remove("active");

}


menuButton.addEventListener("click", function() {

    sidebar.classList.toggle("mobile-open");

    sidebarOverlay.classList.toggle("active");

});


sidebarOverlay.addEventListener("click", function() {

    closeMobileSidebar();

});


/* =========================================================
   NOTIFICATIONS
   ========================================================= */

const notificationButton =
    document.getElementById("notificationButton");


notificationButton.addEventListener("click", function() {

    showPage("alerts");

});


/* =========================================================
   SEDIMENT LIMIT
   ========================================================= */

const limitForm =
    document.getElementById("limitForm");

const limitInput =
    document.getElementById("limitInput");

const currentLimit =
    document.getElementById("currentLimit");

const dashboardLimit =
    document.getElementById("dashboardLimit");

const limitCardValue =
    document.getElementById("limitCardValue");

const limitMessage =
    document.getElementById("limitMessage");


limitForm.addEventListener("submit", function(event) {

    event.preventDefault();


    const newLimit =
        Number(limitInput.value);


    if (
        Number.isNaN(newLimit) ||
        newLimit < 1 ||
        newLimit > 100
    ) {

        limitMessage.textContent =
            "Enter a value between 1% and 100%.";

        limitMessage.style.color =
            "var(--critical)";

        return;
    }


    currentLimit.textContent = newLimit;

    dashboardLimit.textContent = newLimit;

    limitCardValue.textContent = newLimit;


    limitMessage.textContent =
        "Sediment limit updated in the frontend mockup.";

    limitMessage.style.color =
        "var(--normal)";

});


/* =========================================================
   RECORD TABS
   ========================================================= */

const recordTabs =
    document.querySelectorAll(".record-tab");

const recordContents =
    document.querySelectorAll(".record-content");


recordTabs.forEach(function(tab) {

    tab.addEventListener("click", function() {

        const recordId =
            this.dataset.record;


        recordTabs.forEach(function(item) {

            item.classList.remove("active");

        });


        recordContents.forEach(function(content) {

            content.style.display = "none";

        });


        this.classList.add("active");


        const selectedRecord =
            document.getElementById(recordId);


        if (selectedRecord) {

            selectedRecord.style.display =
                "block";

        }

    });

});


/* =========================================================
   RECORD SEARCH
   ========================================================= */

const recordSearch =
    document.getElementById("recordSearch");

const recordsTable =
    document.getElementById("recordsTable");


if (recordSearch && recordsTable) {

    recordSearch.addEventListener(
        "input",
        function() {

            const searchText =
                this.value.toLowerCase();


            const rows =
                recordsTable.querySelectorAll(
                    "tbody tr"
                );


            rows.forEach(function(row) {

                const rowText =
                    row.textContent.toLowerCase();


                row.style.display =
                    rowText.includes(searchText)
                        ? ""
                        : "none";

            });

        }
    );

}


/* =========================================================
   MONITORING FILTER
   ========================================================= */

const monitorFilter =
    document.getElementById("monitorFilter");


if (monitorFilter) {

    monitorFilter.addEventListener(
        "change",
        function() {

            const filter =
                this.value;


            const rows =
                document.querySelectorAll(
                    "#monitoring tbody tr"
                );


            rows.forEach(function(row) {

                const sediment =
                    parseInt(
                        row.children[1].textContent
                    );


                let show = true;


                if (filter === "normal") {

                    show =
                        sediment < 55;

                }


                if (filter === "high") {

                    show =
                        sediment >= 55;

                }


                row.style.display =
                    show ? "" : "none";

            });

        }
    );

}


/* =========================================================
   MOCK SENSOR DISPLAY
   ========================================================= */

function updateMockSedimentLevel(level) {

    const dashboardSediment =
        document.getElementById(
            "dashboardSediment"
        );

    const monitoringValue =
        document.getElementById(
            "monitoringValue"
        );

    const dashboardProgress =
        document.getElementById(
            "dashboardProgress"
        );


    if (dashboardSediment) {

        dashboardSediment.textContent =
            level;

    }


    if (monitoringValue) {

        monitoringValue.textContent =
            level;

    }


    if (dashboardProgress) {

        dashboardProgress.style.width =
            level + "%";

    }

}


/* =========================================================
   STATE HELPER
   ========================================================= */

function getSedimentState(
    level,
    limit
) {

    if (level >= limit) {

        return {
            name: "Critical",
            className: "critical"
        };

    }


    if (level >= limit * 0.75) {

        return {
            name: "Warning",
            className: "warning"
        };

    }


    return {
        name: "Normal",
        className: "normal"
    };

}


/* =========================================================
   MOCK REAL-TIME UPDATE
   ========================================================= */

let mockSedimentLevel = 62;

const configuredLimit = 70;


function simulateSensorUpdate() {

    const variation =
        Math.floor(
            Math.random() * 5
        ) - 2;


    mockSedimentLevel =
        Math.max(
            0,
            Math.min(
                100,
                mockSedimentLevel + variation
            )
        );


    updateMockSedimentLevel(
        mockSedimentLevel
    );

}


/*
    Mock update every 5 seconds.

    This does NOT connect to hardware.
    It only demonstrates how the dashboard
    can visually respond to changing readings.
*/

setInterval(
    simulateSensorUpdate,
    5000
);


/* =========================================================
   INITIAL STATE
   ========================================================= */

document.addEventListener(
    "DOMContentLoaded",
    function() {

        updateMockSedimentLevel(62);

    }
);