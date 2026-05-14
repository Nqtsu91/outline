"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("documents", "type", {
      type: Sequelize.STRING(32),
      allowNull: false,
      defaultValue: "document",
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("documents", "type");
  },
};
