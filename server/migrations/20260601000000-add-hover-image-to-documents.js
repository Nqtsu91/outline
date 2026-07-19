"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("documents", "hoverImage", {
      type: Sequelize.STRING(4096),
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("documents", "hoverImage");
  },
};
