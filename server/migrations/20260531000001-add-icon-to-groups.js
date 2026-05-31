"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("groups", "icon", {
      type: Sequelize.STRING,
      allowNull: true,
    });
    await queryInterface.addColumn("groups", "color", {
      type: Sequelize.STRING,
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("groups", "icon");
    await queryInterface.removeColumn("groups", "color");
  },
};
